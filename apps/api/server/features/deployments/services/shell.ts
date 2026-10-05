import { TRPCError } from '@trpc/server';
import { randomBytes } from 'node:crypto';
import * as z from 'zod';
import { db } from '../../../infrastructure/db';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import { requirePersonal, type Principal } from '../../auth/services/request-principal';
import { accessibleDeployment } from './access';
import { DockerContainerLifecycle } from '../runtime/container-lifecycle';
import { assertContainerOwned } from '../runtime/container-ownership';
import { deploymentInstanceId } from '../runtime/identity';
import { containerName } from '../runtime/preview-route-identity';
import { event } from '../repositories/history';

export const shellInput = z.strictObject({
  projectId: z.string().min(1),
  deploymentId: z.string().min(1),
  executable: z
    .string()
    .regex(/^\/[A-Za-z0-9_./-]+$/)
    .max(512)
    .optional(),
  cols: z.number().int().min(1).max(1000).default(80),
  rows: z.number().int().min(1).max(1000).default(24),
  term: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(64)
    .default('xterm-256color'),
});
export type ShellGrant = z.infer<typeof shellInput> & {
  containerId: string;
  executable: string;
  sessionId: string;
  userId: string;
  expiresAt: number;
};
const grants = new Map<string, ShellGrant>();

export async function inspectShellContainer(
  principal: Principal,
  input: Pick<ShellGrant, 'projectId' | 'deploymentId'>,
  engine = new DockerEngine(),
) {
  requirePersonal(principal);
  const row = accessibleDeployment(input.projectId, input.deploymentId, principal.user, 'manage');
  if (
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.desiredState !== 'running' ||
    !['healthy', 'unhealthy', 'starting'].includes(row.status)
  )
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Deployment origin is not running.',
    });
  const container = await new DockerContainerLifecycle(
    engine,
    deploymentInstanceId(),
  ).inspectContainer(containerName(deploymentInstanceId(), row.id, 'origin'));
  if (!container?.State.Running)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Deployment origin is not running.',
    });
  assertContainerOwned(
    container,
    deploymentInstanceId(),
    { id: row.id, projectId: row.projectId },
    'origin',
  );
  return container;
}

export async function createShellGrant(principal: Principal, input: z.infer<typeof shellInput>) {
  const engine = new DockerEngine();
  try {
    const personal = requirePersonal(principal);
    const container = await inspectShellContainer(principal, input, engine);
    let executable: string | undefined;
    for (const candidate of input.executable
      ? [input.executable]
      : ['/bin/sh', '/bin/bash', '/bin/ash']) {
      try {
        const exec = await engine.request<{ Id: string }>(
          'POST',
          `/containers/${encodeURIComponent(container.Id)}/exec`,
          {
            Cmd: [
              candidate,
              '-c',
              'command -v cat >/dev/null && command -v tr >/dev/null && command -v grep >/dev/null && command -v sleep >/dev/null',
            ],
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            Privileged: false,
          },
        );
        await engine.request('POST', `/exec/${encodeURIComponent(exec.body.Id)}/start`, {
          Detach: false,
          Tty: false,
        });
        const result = await engine.request<{ ExitCode: number | null }>(
          'GET',
          `/exec/${encodeURIComponent(exec.body.Id)}/json`,
        );
        if (result.body.ExitCode === 0) {
          executable = candidate;
          break;
        }
      } catch {
        /* Try the next supported POSIX shell. */
      }
    }
    if (!executable)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'This image has no supported POSIX shell with cat, tr, grep, and sleep for safe session cleanup.',
      });
    for (const [key, grant] of grants) if (grant.expiresAt < Date.now()) grants.delete(key);
    if (grants.size >= 128) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    const secret = randomBytes(32).toString('base64url');
    grants.set(secret, {
      ...input,
      executable,
      containerId: container.Id,
      sessionId: personal.id,
      userId: principal.user.id,
      expiresAt: Date.now() + 30_000,
    });
    return { grant: secret, executable, expiresIn: 30 };
  } catch (error) {
    // Audit only accessible deployments; do not let an invalid ID create audit rows.
    try {
      accessibleDeployment(input.projectId, input.deploymentId, principal.user);
      shellAudit(principal, input, 'shell.denied');
    } catch {
      /* inaccessible */
    }
    throw error;
  }
}
export async function consumeShellGrant(principal: Principal, secret: string) {
  const grant = grants.get(secret);
  grants.delete(secret);
  if (
    !grant ||
    grant.expiresAt < Date.now() ||
    grant.sessionId !== requirePersonal(principal).id ||
    grant.userId !== principal.user.id
  )
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid or expired shell grant.' });
  const container = await inspectShellContainer(principal, grant);
  if (container.Id !== grant.containerId)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Deployment container was replaced. Open a new shell.',
    });
  return grant;
}
export function shellAudit(
  principal: Principal,
  input: Pick<ShellGrant, 'projectId' | 'deploymentId'>,
  name: string,
  reason?: string,
) {
  event(
    db,
    input.projectId,
    input.deploymentId,
    name,
    { containerRole: 'origin', ...(reason ? { reason } : {}) },
    new Date(),
    principal.user,
  );
}
