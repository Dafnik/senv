import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  getAuthoritativeSessionFromCtx,
} from 'better-auth/api';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as z from 'zod';
import { user } from '../../../../../../drizzle/schema';
import { accountPasswordSchema, emailAddressSchema } from '../../../../shared/validation';
import { db } from '../../../infrastructure/db';
import env from '../../../infrastructure/env';
import { sendPasswordReset } from '../../notifications/services/email';
import {
  deleteAccountSessions,
  findAccount,
  findAccountByEmail,
  findCredential,
  updateCredentialPassword,
  verifyAccountEmail,
} from '../repositories/accounts';
import {
  deletePasswordResetVerifications,
  deleteVerificationByIdentifier,
  deleteVerificationByValue,
  findVerification,
  insertVerification,
} from '../repositories/verification';

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
  const recipient = findAccount(userId, database);
  const credential = findCredential(userId, database);
  return recipient && !recipient.banned && credential?.password ? { recipient, credential } : null;
}
async function sendReset(recipient: typeof user.$inferSelect) {
  const token = randomBytes(32).toString('base64url');
  const key = identifier(token);
  const value = JSON.stringify({ userId: recipient.id, email: recipient.email });
  db.transaction((tx) => {
    deletePasswordResetVerifications(tx, value);
    insertVerification(tx, {
      id: randomUUID(),
      identifier: key,
      value,
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });
  const url = new URL('/reset-password', env.APP_URL);
  url.searchParams.set('token', token);
  try {
    await sendPasswordReset({ to: recipient.email, name: recipient.name, url: url.href });
  } catch (error) {
    deleteVerificationByIdentifier(key);
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
  const saved = findVerification(identifier(token), database);
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
        const recipient = findAccountByEmail(ctx.body.email);
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
            updateCredentialPassword(tx, credential.id, password);
            verifyAccountEmail(tx, recipient.id);
            deleteAccountSessions(tx, recipient.id);
            deleteVerificationByValue(
              tx,
              JSON.stringify({ userId: recipient.id, email: recipient.email }),
            );
          },
          { behavior: 'immediate' },
        );
        return ctx.json({ status: true });
      },
    ),
  },
};
