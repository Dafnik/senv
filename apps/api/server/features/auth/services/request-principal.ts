import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { automationToken, cliSession, session, user } from '../../../../../../drizzle/schema';
import { db } from '../../../infrastructure/db';
import { auth } from '../auth';
import { assertProjectAccess } from '../../projects/services/access';

export type Principal = {
  user: typeof user.$inferSelect;
  session: typeof session.$inferSelect | null;
  automation: typeof automationToken.$inferSelect | null;
};
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

export async function resolvePrincipal(headers: Headers): Promise<Principal> {
  const authorization = headers.get('authorization');
  if (authorization && !/^Bearer \S+$/i.test(authorization))
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  const credential = authorization?.slice(7);
  if (credential?.startsWith('senv_at_')) {
    const token = db
      .select()
      .from(automationToken)
      .where(eq(automationToken.tokenHash, hashToken(credential)))
      .get();
    if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= new Date()))
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    const account = db.select().from(user).where(eq(user.id, token.userId)).get();
    if (!account || account.banned) throw new TRPCError({ code: 'UNAUTHORIZED' });
    assertProjectAccess(token.projectId, account, token.permission);
    if (!token.lastUsedAt || token.lastUsedAt.getTime() < Date.now() - 60_000)
      db.update(automationToken)
        .set({ lastUsedAt: new Date() })
        .where(eq(automationToken.id, token.id))
        .run();
    return { user: account, session: null, automation: token };
  }
  const resolved = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!resolved) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const current = db.select().from(session).where(eq(session.id, resolved.session.id)).get();
  const account = current && db.select().from(user).where(eq(user.id, current.userId)).get();
  if (!current || current.expiresAt <= new Date() || !account || account.banned)
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  const metadata = db.select().from(cliSession).where(eq(cliSession.id, current.id)).get();
  if (metadata && metadata.lastActivityAt.getTime() < Date.now() - 60_000)
    db.update(cliSession)
      .set({ lastActivityAt: new Date() })
      .where(eq(cliSession.id, current.id))
      .run();
  if (!metadata && current.updatedAt.getTime() < Date.now() - 60_000)
    db.update(session).set({ updatedAt: new Date() }).where(eq(session.id, current.id)).run();
  return { user: account, session: current, automation: null };
}

const readOperations = new Set([
  'artifacts.list',
  'artifacts.detail',
  'artifacts.directory',
  'artifacts.file',
  'artifacts.download',
  'me',
  'cli.access',
  'cli.project',
  'deployments.list',
  'deployments.detail',
  'deployments.logs',
  'deployments.logsForward',
  'deployments.resources',
  'deployments.resourceHistory',
  'deployments.previewStatus',
  'deployments.history',
]);
const manageOperations = new Set([
  'deployments.publish',
  'deployments.uploadConstraints',
  'deployments.setPinned',
  'deployments.stop',
  'deployments.restart',
  'deployments.delete',
  'deployments.assignTag',
  'deployments.removeTag',
  'artifacts.upload',
]);
export function authorizeOperation(principal: Principal, path: string, input: unknown) {
  if (!principal.automation) return;
  const token = principal.automation;
  const projectId =
    input && typeof input === 'object' && 'projectId' in input ? input.projectId : undefined;
  if (
    (!readOperations.has(path) && !(token.permission === 'manage' && manageOperations.has(path))) ||
    (path !== 'me' &&
      path !== 'cli.access' &&
      path !== 'cli.project' &&
      projectId !== token.projectId)
  )
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Automation token does not allow this operation or project.',
    });
}
export function requirePersonal(principal: Principal) {
  if (!principal.session || principal.automation || principal.session.impersonatedBy)
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'A personal, non-impersonated session is required.',
    });
  return principal.session;
}
