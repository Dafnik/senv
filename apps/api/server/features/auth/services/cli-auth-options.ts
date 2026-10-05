import { APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import {
  cliDeviceRequest,
  cliSession,
  deviceCode,
  session,
} from '../../../../../../drizzle/schema';
import { db } from '../../../infrastructure/db';
import { findAccount, findCredential } from '../repositories/accounts';

type AuthContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];
const cliContext = (ctx: AuthContext) =>
  ctx.context as AuthContext['context'] & {
    returned?: unknown;
    cliDeviceMetadata?: typeof cliDeviceRequest.$inferSelect;
  };
const cleanCode = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replaceAll('-', '');
export function eligibleCliAccount(userId: string) {
  const user = findAccount(userId);
  return user && !user.banned && findCredential(userId)?.password ? user : null;
}

export async function beforeCliAuth(ctx: AuthContext) {
  if (!ctx.path.startsWith('/device')) return;
  if (ctx.path === '/device/code') {
    if (ctx.body?.user_id !== undefined || ctx.body?.scope)
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
    if (code?.userId === actor.user.id)
      db.update(cliDeviceRequest)
        .set({ approvingSessionId: actor.session.id })
        .where(eq(cliDeviceRequest.id, code.id))
        .run();
  }
}

export async function afterCliAuth(ctx: AuthContext) {
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
        !eligibleCliAccount(created.userId)
      )
        throw new Error('Invalid CLI authorization.');
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
