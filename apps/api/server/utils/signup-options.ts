import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  getAuthoritativeSessionFromCtx,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { and, eq } from 'drizzle-orm';
import * as z from 'zod';
import { account, session, user, verification } from '../../../../drizzle/schema';
import { passwordMaxLength, passwordMinLength } from '../../shared/validation';
import { db } from './db';
import { sendAccountSignup } from './email';
import env from './env';

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
    tx.delete(verification).where(eq(verification.value, value)).run();
    tx.insert(verification)
      .values({
        id: randomUUID(),
        identifier,
        value,
        expiresAt: new Date(Date.now() + signupExpiresIn * 1000),
      })
      .run();
  });
  const url = new URL('/signup', env.APP_URL);
  url.searchParams.set('token', token);
  try {
    await sendAccountSignup({ to: recipient.email, name: recipient.name, url: url.href });
  } catch (error) {
    db.delete(verification).where(eq(verification.identifier, identifier)).run();
    throw error;
  }
}

function findSignup(token: string, database: Pick<typeof db, 'select'> = db) {
  const saved = database
    .select()
    .from(verification)
    .where(eq(verification.identifier, tokenIdentifier(token)))
    .get();
  if (!saved || saved.expiresAt.getTime() <= Date.now()) throw invalidLink();
  const value = JSON.parse(saved.value) as { userId: string; email: string };
  const recipient = database
    .select()
    .from(user)
    .where(and(eq(user.id, value.userId), eq(user.email, value.email)))
    .get();
  if (!recipient || recipient.banned) throw invalidLink();
  const credential = database
    .select()
    .from(account)
    .where(and(eq(account.userId, recipient.id), eq(account.providerId, 'credential')))
    .get();
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
          password: z.string().min(passwordMinLength).max(passwordMaxLength),
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
              tx.update(account).set({ password }).where(eq(account.id, credential.id)).run();
            } else {
              tx.insert(account)
                .values({
                  id: randomUUID(),
                  userId: recipient.id,
                  accountId: recipient.id,
                  providerId: 'credential',
                  password,
                })
                .run();
            }
            tx.update(user).set({ emailVerified: true }).where(eq(user.id, recipient.id)).run();
            tx.delete(verification)
              .where(eq(verification.value, signupValue(recipient)))
              .run();
            tx.delete(session).where(eq(session.userId, recipient.id)).run();
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
        const recipient = db.select().from(user).where(eq(user.id, ctx.body.userId)).get();
        if (!recipient || recipient.banned)
          throw new APIError('BAD_REQUEST', {
            message: 'This user cannot receive a signup email.',
          });
        const credential = db
          .select()
          .from(account)
          .where(and(eq(account.userId, recipient.id), eq(account.providerId, 'credential')))
          .get();
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
