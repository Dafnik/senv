import { rateLimit } from '../../infrastructure/rate-limit';
import { closeShells } from '../deployments/services/shell-registry';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, ne, isNull } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import * as z from 'zod';
import {
  automationToken,
  cliDeviceRequest,
  cliSession,
  deviceCode,
  session,
} from '../../../../../drizzle/schema';
import { db } from '../../infrastructure/db';
import env from '../../infrastructure/env';
import { authedProcedure, publicProcedure, router } from '../../trpc/trpc';
import { assertProjectAccess } from '../projects/services/access';
import {
  findProject,
  findProjectByPreviewSlug,
  findProjectMembership,
} from '../projects/repositories/projects';
import { hashToken, requirePersonal } from './services/request-principal';

function effectiveProjectPermission(
  projectId: string,
  actor: { id: string; role?: string | null },
) {
  assertProjectAccess(projectId, actor);
  const role = actor.role === 'admin' ? 'admin' : findProjectMembership(projectId, actor.id)!.role;
  return role === 'admin'
    ? ('admin' as const)
    : role === 'developer'
      ? ('manage' as const)
      : ('read' as const);
}
const idInput = z.object({ id: z.string().min(1) });
export const cliRouter = router({
  access: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }).optional())
    .query(({ ctx, input }) =>
      ctx.automation
        ? {
            kind: 'automation' as const,
            projectId: ctx.automation.projectId,
            permission: ctx.automation.permission,
            impersonated: false,
            sessionId: null,
          }
        : {
            kind: 'personal' as const,
            projectId: input?.projectId ?? null,
            permission: input?.projectId
              ? effectiveProjectPermission(input.projectId, ctx.user)
              : null,
            impersonated: Boolean(ctx.session?.impersonatedBy),
            sessionId: ctx.session?.id ?? null,
          },
    ),
  instance: publicProcedure.query(() => ({
    apiUrl: env.API_URL,
    appUrl: env.APP_URL,
    clientId: 'senv-cli',
  })),
  project: authedProcedure
    .input(z.object({ project: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const id =
        findProject(input.project)?.id ??
        findProjectByPreviewSlug(input.project)?.id ??
        input.project;
      if (ctx.automation && id !== ctx.automation.projectId)
        throw new TRPCError({ code: 'FORBIDDEN' });
      const project = assertProjectAccess(id, ctx.user);
      const role = ctx.automation
        ? ctx.automation.permission === 'manage'
          ? 'developer'
          : 'viewer'
        : ctx.user.role === 'admin'
          ? 'admin'
          : findProjectMembership(id, ctx.user.id)!.role;
      return {
        id: project.id,
        name: project.name,
        previewSlug: project.previewSlug,
        role,
        permission:
          role === 'admin'
            ? ('admin' as const)
            : role === 'developer'
              ? ('manage' as const)
              : ('read' as const),
      };
    }),
  device: authedProcedure
    .input(z.object({ userCode: z.string().trim().min(1) }))
    .query(({ ctx, input }) => {
      requirePersonal(ctx);
      rateLimit(`device:${ctx.user.id}`, 20, 60_000);
      const code = db
        .select()
        .from(deviceCode)
        .where(eq(deviceCode.userCode, input.userCode.toUpperCase().replaceAll('-', '')))
        .get();
      if (
        !code ||
        code.expiresAt <= new Date() ||
        code.clientId !== 'senv-cli' ||
        (code.userId && code.userId !== ctx.user.id)
      )
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invalid or expired authorization code.',
        });
      const metadata = db
        .select()
        .from(cliDeviceRequest)
        .where(eq(cliDeviceRequest.id, code.id))
        .get();
      return {
        label: metadata?.label ?? 'senv CLI',
        version: metadata?.version ?? 'unknown',
        expiresAt: code.expiresAt,
        status: code.status,
        appUrl: env.APP_URL,
      };
    }),
  sessions: authedProcedure.query(({ ctx }) => {
    const current = requirePersonal(ctx);
    return db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        metadata: {
          label: cliSession.label,
          version: cliSession.version,
          lastActivityAt: cliSession.lastActivityAt,
        },
      })
      .from(session)
      .leftJoin(cliSession, eq(session.id, cliSession.id))
      .where(and(eq(session.userId, ctx.user.id), gt(session.expiresAt, new Date())))
      .orderBy(desc(session.createdAt))
      .all()
      .map(({ metadata, updatedAt, ...row }) => ({
        ...row,
        kind: metadata ? ('cli' as const) : ('browser' as const),
        label: metadata?.label ?? row.userAgent ?? 'Browser',
        version: metadata?.version ?? null,
        lastActivityAt: metadata?.lastActivityAt ?? updatedAt,
        current: row.id === current.id,
      }));
  }),
  revokeSession: authedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    requirePersonal(ctx);
    const removed = db
      .delete(session)
      .where(and(eq(session.id, input.id), eq(session.userId, ctx.user.id)))
      .returning({ id: session.id })
      .get();
    if (!removed) throw new TRPCError({ code: 'NOT_FOUND' });
    await closeShells({ sessionId: input.id }, 'session_revoked');
    return { success: true };
  }),
  revokeOtherSessions: authedProcedure.mutation(async ({ ctx }) => {
    const current = requirePersonal(ctx);
    const removed = db
      .delete(session)
      .where(and(eq(session.userId, ctx.user.id), ne(session.id, current.id)))
      .returning({ id: session.id })
      .all();
    await Promise.all(removed.map((row) => closeShells({ sessionId: row.id }, 'session_revoked')));
    return { success: true };
  }),
  tokens: authedProcedure.query(({ ctx }) => {
    requirePersonal(ctx);
    return db
      .select({
        id: automationToken.id,
        name: automationToken.name,
        prefix: automationToken.prefix,
        projectId: automationToken.projectId,
        permission: automationToken.permission,
        createdAt: automationToken.createdAt,
        expiresAt: automationToken.expiresAt,
        revokedAt: automationToken.revokedAt,
        lastUsedAt: automationToken.lastUsedAt,
      })
      .from(automationToken)
      .where(eq(automationToken.userId, ctx.user.id))
      .orderBy(desc(automationToken.createdAt))
      .all();
  }),
  createToken: authedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        projectId: z.string().min(1),
        permission: z.enum(['read', 'manage']),
        days: z.number().int().positive().optional(),
        expiresInSeconds: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      requirePersonal(ctx);
      assertProjectAccess(input.projectId, ctx.user, input.permission);
      const secret = `senv_at_${randomBytes(32).toString('base64url')}`;
      const id = randomUUID();
      if (input.days !== undefined && input.expiresInSeconds !== undefined)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose one token lifetime.' });
      const seconds =
        input.expiresInSeconds === undefined ? (input.days ?? 30) * 86400 : input.expiresInSeconds;
      const expiresAt = seconds === null ? null : new Date(Date.now() + seconds * 1000);
      if (expiresAt && !Number.isFinite(expiresAt.getTime()))
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Token lifetime exceeds the supported date range.',
        });
      db.insert(automationToken)
        .values({
          id,
          name: input.name,
          projectId: input.projectId,
          permission: input.permission,
          userId: ctx.user.id,
          tokenHash: hashToken(secret),
          prefix: secret.slice(0, 16),
          expiresAt,
        })
        .run();
      return { id, secret, expiresAt };
    }),
  revokeToken: authedProcedure.input(idInput).mutation(({ ctx, input }) => {
    requirePersonal(ctx);
    const removed = db
      .update(automationToken)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(automationToken.id, input.id),
          eq(automationToken.userId, ctx.user.id),
          isNull(automationToken.revokedAt),
        ),
      )
      .returning({ id: automationToken.id })
      .get();
    if (!removed) throw new TRPCError({ code: 'NOT_FOUND' });
    return { success: true };
  }),
});
