import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  getAuthoritativeSessionFromCtx,
} from 'better-auth/api';
import { and, eq, like } from 'drizzle-orm';
import * as z from 'zod';
import { account, session, user, verification } from '../../../../drizzle/schema';
import { accountPasswordSchema, emailAddressSchema } from '../../shared/validation';
import { db } from './db';
import { sendPasswordReset } from './email';
import env from './env';

const identifier = (token: string) =>
  `account-password:${createHash('sha256').update(token).digest('hex')}`;
const genericResponse = {
  status: true,
  message: 'If this account can reset its password, a reset email has been sent.',
};
const invalidLink = () =>
  new APIError('BAD_REQUEST', {
    message: 'This reset link is invalid or expired. Request a new password reset email.',
  });
function eligible(database: Pick<typeof db, 'select'>, userId: string) {
  const recipient = database.select().from(user).where(eq(user.id, userId)).get();
  const credential = database
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .get();
  return recipient && !recipient.banned && credential?.password ? { recipient, credential } : null;
}
async function sendReset(recipient: typeof user.$inferSelect) {
  const token = randomBytes(32).toString('base64url');
  const key = identifier(token);
  const value = JSON.stringify({ userId: recipient.id, email: recipient.email });
  db.transaction((tx) => {
    tx.delete(verification)
      .where(
        and(eq(verification.value, value), like(verification.identifier, 'account-password:%')),
      )
      .run();
    tx.insert(verification)
      .values({
        id: randomUUID(),
        identifier: key,
        value,
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .run();
  });
  const url = new URL('/reset-password', env.APP_URL);
  url.searchParams.set('token', token);
  try {
    await sendPasswordReset({ to: recipient.email, name: recipient.name, url: url.href });
  } catch (error) {
    db.delete(verification).where(eq(verification.identifier, key)).run();
    throw error;
  }
}
async function sendResetOrThrow(
  recipient: typeof user.$inferSelect,
  onError: (error: unknown) => void,
) {
  try {
    await sendReset(recipient);
  } catch (error) {
    onError(error);
    throw new APIError('INTERNAL_SERVER_ERROR', {
      message: 'The reset email could not be sent. Please try again.',
    });
  }
}
function findReset(token: string, database: Pick<typeof db, 'select'> = db) {
  const saved = database
    .select()
    .from(verification)
    .where(eq(verification.identifier, identifier(token)))
    .get();
  if (!saved || saved.expiresAt.getTime() <= Date.now()) throw invalidLink();
  const value = JSON.parse(saved.value) as { userId: string; email: string };
  const target = eligible(database, value.userId);
  if (!target || target.recipient.email !== value.email) throw invalidLink();
  return { ...target, saved };
}
export const accountPassword = {
  id: 'account-password',
  endpoints: {
    requestAccountPasswordReset: createAuthEndpoint(
      '/account-password/request',
      {
        method: 'POST',
        use: [formCsrfMiddleware],
        body: z.object({ email: emailAddressSchema }),
      },
      async (ctx) => {
        const recipient = db.select().from(user).where(eq(user.email, ctx.body.email)).get();
        if (recipient && eligible(db, recipient.id)) {
          try {
            await sendReset(recipient);
          } catch (error) {
            ctx.context.logger.error('Password reset email delivery failed.', error);
          }
        }
        return ctx.json(genericResponse);
      },
    ),
    selfAccountPasswordReset: createAuthEndpoint(
      '/account-password/self-reset',
      { method: 'POST', use: [formCsrfMiddleware], body: z.object({}) },
      async (ctx) => {
        const actor = await getAuthoritativeSessionFromCtx(ctx);
        if (!actor) throw new APIError('UNAUTHORIZED');
        const target = eligible(db, actor.user.id);
        if (!target)
          throw new APIError('BAD_REQUEST', { message: 'This account cannot reset its password.' });
        await sendResetOrThrow(target.recipient, (error) =>
          ctx.context.logger.error('Password reset email delivery failed.', error),
        );
        return ctx.json({ status: true });
      },
    ),
    adminAccountPasswordReset: createAuthEndpoint(
      '/account-password/admin-reset',
      { method: 'POST', use: [formCsrfMiddleware], body: z.object({ userId: z.string().min(1) }) },
      async (ctx) => {
        const actor = await getAuthoritativeSessionFromCtx(ctx);
        if (!actor) throw new APIError('UNAUTHORIZED');
        if (actor.user['role'] !== 'admin' || actor.session['impersonatedBy'])
          throw new APIError('FORBIDDEN');
        const target = eligible(db, ctx.body.userId);
        if (!target)
          throw new APIError('BAD_REQUEST', {
            message: 'This account needs a signup email or cannot reset its password.',
          });
        await sendResetOrThrow(target.recipient, (error) =>
          ctx.context.logger.error('Password reset email delivery failed.', error),
        );
        return ctx.json({ status: true });
      },
    ),
    completeAccountPasswordReset: createAuthEndpoint(
      '/account-password/complete',
      {
        method: 'POST',
        use: [formCsrfMiddleware],
        body: z.object({
          token: z.string().min(1).max(128),
          password: accountPasswordSchema,
        }),
      },
      async (ctx) => {
        findReset(ctx.body.token);
        const password = await ctx.context.password.hash(ctx.body.password);
        db.transaction(
          (tx) => {
            const { recipient, credential } = findReset(ctx.body.token, tx);
            tx.update(account).set({ password }).where(eq(account.id, credential.id)).run();
            tx.update(user).set({ emailVerified: true }).where(eq(user.id, recipient.id)).run();
            tx.delete(session).where(eq(session.userId, recipient.id)).run();
            tx.delete(verification)
              .where(
                eq(
                  verification.value,
                  JSON.stringify({ userId: recipient.id, email: recipient.email }),
                ),
              )
              .run();
          },
          { behavior: 'immediate' },
        );
        return ctx.json({ status: true });
      },
    ),
  },
};
