import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  getAuthoritativeSessionFromCtx,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as z from 'zod';
import { accountPasswordSchema } from '../../../../shared/validation';
import { db } from '../../../infrastructure/db';
import env from '../../../infrastructure/env';
import { sendAccountSignup } from '../../notifications/services/email';
import {
  deleteAccountSessions,
  findAccount,
  findAccountForSignup,
  findCredential,
  insertCredential,
  updateCredentialPassword,
  verifyAccountEmail,
} from '../repositories/accounts';
import {
  deleteVerificationByIdentifier,
  deleteVerificationByValue,
  findVerification,
  insertVerification,
} from '../repositories/verification';

export const signupExpiresIn = 60 * 60;
const invalidLink = () =>
  new APIError('BAD_REQUEST', {
    message: 'This signup link is invalid or expired. Ask your admin to send a new signup email.',
  });
const tokenIdentifier = (token: string) =>
  `account-signup:${createHash('sha256').update(token).digest('hex')}`;
const signupValue = (recipient: { id: string; email: string }) =>
  JSON.stringify({ userId: recipient.id, email: recipient.email });

export async function sendAccountSignupInvitation(recipient: {
  id: string;
  email: string;
  name: string;
}) {
  const token = randomBytes(32).toString('base64url');
  const identifier = tokenIdentifier(token);
  const value = signupValue(recipient);
  db.transaction((tx) => {
    deleteVerificationByValue(tx, value);
    insertVerification(tx, {
      id: randomUUID(),
      identifier,
      value,
      expiresAt: new Date(Date.now() + signupExpiresIn * 1000),
    });
  });
  const url = new URL('/signup', env.APP_URL);
  url.searchParams.set('token', token);
  try {
    await sendAccountSignup({ to: recipient.email, name: recipient.name, url: url.href });
  } catch (error) {
    deleteVerificationByIdentifier(identifier);
    throw error;
  }
}

function findSignup(token: string, database: Pick<typeof db, 'select'> = db) {
  const saved = findVerification(tokenIdentifier(token), database);
  if (!saved || saved.expiresAt.getTime() <= Date.now()) throw invalidLink();
  const value = JSON.parse(saved.value) as { userId: string; email: string };
  const recipient = findAccountForSignup(value.userId, value.email, database);
  if (!recipient || recipient.banned) throw invalidLink();
  const credential = findCredential(recipient.id, database);
  if (recipient.emailVerified && credential?.password) throw invalidLink();
  return { saved, recipient, credential };
}

export const accountSignup = {
  id: 'account-signup',
  endpoints: {
    signupDetails: createAuthEndpoint(
      '/account-signup/details',
      {
        method: 'GET',
        query: z.object({ token: z.string().min(1).max(128) }),
      },
      async (ctx) => {
        ctx.setHeader('Cache-Control', 'no-store');
        const { recipient } = findSignup(ctx.query.token);
        return ctx.json({ name: recipient.name, email: recipient.email });
      },
    ),
    completeSignup: createAuthEndpoint(
      '/account-signup/complete',
      {
        method: 'POST',
        use: [formCsrfMiddleware],
        body: z.object({
          token: z.string().min(1).max(128),
          password: accountPasswordSchema,
        }),
      },
      async (ctx) => {
        findSignup(ctx.body.token);
        const password = await ctx.context.password.hash(ctx.body.password);
        // Recheck and consume the link under the write lock, together with password creation.
        const recipient = db.transaction(
          (tx) => {
            const { recipient, credential } = findSignup(ctx.body.token, tx);
            if (credential) {
              updateCredentialPassword(tx, credential.id, password);
            } else {
              insertCredential(tx, {
                id: randomUUID(),
                userId: recipient.id,
                accountId: recipient.id,
                providerId: 'credential',
                password,
              });
            }
            verifyAccountEmail(tx, recipient.id);
            deleteVerificationByValue(tx, signupValue(recipient));
            deleteAccountSessions(tx, recipient.id);
            return { ...recipient, emailVerified: true };
          },
          { behavior: 'immediate' },
        );
        const newSession = await ctx.context.internalAdapter.createSession(recipient.id);
        if (!newSession)
          throw new APIError('INTERNAL_SERVER_ERROR', {
            message:
              'Your account is ready, but automatic login failed. Please log in with your new password.',
          });
        await setSessionCookie(ctx, { session: newSession, user: recipient });
        return ctx.json({ status: true });
      },
    ),
    resendSignup: createAuthEndpoint(
      '/account-signup/resend',
      {
        method: 'POST',
        use: [formCsrfMiddleware],
        body: z.object({ userId: z.string().min(1) }),
      },
      async (ctx) => {
        const admin = await getAuthoritativeSessionFromCtx(ctx);
        if (!admin) throw new APIError('UNAUTHORIZED');
        if (admin.user['role'] !== 'admin') throw new APIError('FORBIDDEN');
        const recipient = findAccount(ctx.body.userId);
        if (!recipient || recipient.banned)
          throw new APIError('BAD_REQUEST', {
            message: 'This user cannot receive a signup email.',
          });
        const credential = findCredential(recipient.id);
        if (recipient.emailVerified && credential?.password)
          throw new APIError('BAD_REQUEST', {
            message: 'This user has already completed signup.',
          });
        try {
          await sendAccountSignupInvitation(recipient);
        } catch (error) {
          ctx.context.logger.error('Signup email delivery failed.', error);
          throw new APIError('INTERNAL_SERVER_ERROR', {
            message: 'The signup email could not be sent. Please try again.',
          });
        }
        return ctx.json({ status: true });
      },
    ),
  },
};
