import { closeShells } from '../../deployments/services/shell-registry';
import { APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { and, eq, isNull } from 'drizzle-orm';
import {
  cliDeviceRequest,
  cliSession,
  deviceCode,
  session,
  member,
} from '../../../../../../drizzle/schema';
import { db } from '../../../infrastructure/db';
import { accountBanned, resolvePrincipal } from './request-principal';
import { findAccount, findCredential } from '../repositories/accounts';

type AuthContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];
const cliContext = (ctx: AuthContext) =>
  ctx.context as AuthContext['context'] & {
    returned?: unknown;
    cliDeviceMetadata?: typeof cliDeviceRequest.$inferSelect;
    leavingMembership?: { userId: string; projectId: string };
  };
const cleanCode = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replaceAll('-', '');
export function eligibleCliAccount(userId: string) {
  const user = findAccount(userId);
  return user && !accountBanned(user) && findCredential(userId)?.password ? user : null;
}

export async function beforeCliAuth(ctx: AuthContext) {
  if (ctx.path === '/organization/leave') {
    const principal = await resolvePrincipal(ctx.headers ?? new Headers()).catch(() => {
      throw new APIError('UNAUTHORIZED');
    });
    cliContext(ctx).leavingMembership = {
      userId: principal.user.id,
      projectId: String(ctx.body?.organizationId ?? ''),
    };
  }
  if (ctx.path === '/admin/impersonate-user') {
    // User before-hooks run before the bearer plugin normalizes Authorization.
    // Resolve the same explicit credential boundary used by tRPC instead.
    const actor = await resolvePrincipal(ctx.headers ?? new Headers()).catch(() => {
      throw new APIError('UNAUTHORIZED');
    });
    if (
      actor.automation ||
      (actor.session &&
        db.select().from(cliSession).where(eq(cliSession.id, actor.session.id)).get())
    )
      throw new APIError('FORBIDDEN', { message: 'Impersonation is browser-only.' });
  }
  if (!ctx.path.startsWith('/device')) return;
  if (ctx.path === '/device/code') {
    if (ctx.body?.user_id !== undefined || ctx.body?.scope !== undefined)
      throw new APIError('BAD_REQUEST', {
        message: 'CLI authorization does not accept user binding or custom scopes.',
      });
    return;
  }
  if (ctx.path === '/device/token') {
    const code = db
      .select()
      .from(deviceCode)
      .where(eq(deviceCode.deviceCode, String(ctx.body?.device_code ?? '')))
      .get();
    if (code?.status === 'approved') {
      const metadata = db
        .select()
        .from(cliDeviceRequest)
        .where(eq(cliDeviceRequest.id, code.id))
        .get();
      const approval = metadata?.approvingSessionId
        ? db.select().from(session).where(eq(session.id, metadata.approvingSessionId)).get()
        : null;
      if (
        !code.userId ||
        !eligibleCliAccount(code.userId) ||
        !approval ||
        approval.userId !== code.userId ||
        approval.expiresAt <= new Date() ||
        approval.impersonatedBy
      )
        throw new APIError('FORBIDDEN', {
          error: 'access_denied',
          error_description: 'Authorization is no longer valid. Start login again.',
        });
      // Keep this request-local copy: the plugin consumes the device row on redemption.
      cliContext(ctx).cliDeviceMetadata = metadata;
    }
    return;
  }
  const actor = await getAuthoritativeSessionFromCtx(ctx);
  if (!actor || !eligibleCliAccount(actor.user.id)) throw new APIError('UNAUTHORIZED');
  if (actor.session['impersonatedBy']) throw new APIError('FORBIDDEN');
  if (ctx.body?.userCode) ctx.body.userCode = cleanCode(ctx.body.userCode);
  if (ctx.query?.user_code) ctx.query.user_code = cleanCode(ctx.query.user_code);
  if (ctx.path === '/device/approve') {
    const code = db
      .select()
      .from(deviceCode)
      .where(eq(deviceCode.userCode, cleanCode(ctx.body?.userCode)))
      .get();
    if (code?.userId === actor.user.id && code.status === 'pending' && code.expiresAt > new Date())
      db.update(cliDeviceRequest)
        .set({ approvingSessionId: actor.session.id })
        .where(and(eq(cliDeviceRequest.id, code.id), isNull(cliDeviceRequest.approvingSessionId)))
        .run();
  }
}

export async function afterCliAuth(ctx: AuthContext) {
  const leaving = cliContext(ctx).leavingMembership;
  if (
    ctx.path === '/organization/leave' &&
    leaving &&
    !db
      .select()
      .from(member)
      .where(and(eq(member.userId, leaving.userId), eq(member.organizationId, leaving.projectId)))
      .get()
  ) {
    await closeShells(leaving, 'permission_lost');
  }
  if (ctx.path === '/device/code') {
    const returned = cliContext(ctx).returned as { device_code?: string } | undefined;
    if (!returned?.device_code) return;
    const code = db
      .select()
      .from(deviceCode)
      .where(eq(deviceCode.deviceCode, returned.device_code))
      .get();
    if (!code) throw new APIError('INTERNAL_SERVER_ERROR');
    try {
      db.insert(cliDeviceRequest)
        .values({
          id: code.id,
          label: (ctx.headers?.get('x-senv-device-label') ?? 'senv CLI').slice(0, 100),
          version: (ctx.headers?.get('x-senv-cli-version') ?? 'unknown').slice(0, 40),
        })
        .run();
    } catch (error) {
      db.delete(deviceCode).where(eq(deviceCode.id, code.id)).run();
      throw error;
    }
  }
  if (ctx.path === '/device/token' && ctx.context.newSession) {
    const metadata = cliContext(ctx).cliDeviceMetadata;
    const created = ctx.context.newSession.session;
    try {
      const approval =
        metadata?.approvingSessionId &&
        db.select().from(session).where(eq(session.id, metadata.approvingSessionId)).get();
      if (
        !metadata ||
        !approval ||
        approval.expiresAt <= new Date() ||
        !eligibleCliAccount(created.userId) ||
        approval.userId !== created.userId ||
        Boolean(approval.impersonatedBy)
      )
        throw new APIError('FORBIDDEN', {
          error: 'access_denied',
          message: 'Invalid CLI authorization.',
        });
      db.insert(cliSession)
        .values({
          id: created.id,
          label: metadata.label,
          version: metadata.version,
          lastActivityAt: new Date(),
        })
        .run();
    } catch (error) {
      db.delete(session)
        .where(and(eq(session.id, created.id), eq(session.userId, created.userId)))
        .run();
      throw error;
    }
  }
}
