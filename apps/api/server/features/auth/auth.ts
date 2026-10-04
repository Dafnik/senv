import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import * as schema from '../../../../../drizzle/schema';
import { db } from '../../infrastructure/db';
import env from '../../infrastructure/env';
import { sendEmailVerification } from '../notifications/services/email';
import { projects, validateProjectRole } from '../projects/auth-options';
import { administerAccount } from './services/account-administration';
import { accountPassword } from './services/password-options';
import { instanceSetup } from './services/setup-options';
import { accountSignup, sendAccountSignupInvitation } from './services/signup-options';

export const auth = betterAuth({
  baseURL: env.API_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  advanced: {
    disableOriginCheck: false,
    // enable cross subdomain cookies for auth sessions, when api and app are on different subdomains of the same root domain
    crossSubDomainCookies: {
      enabled: true,
      domain: env.ROOT_DOMAIN,
    },
  },
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
  }),
  emailAndPassword: { enabled: true, disableSignUp: true, revokeSessionsOnPasswordReset: true },
  emailVerification: {
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailVerification({ to: user.email, name: user.name, url });
    },
  },
  rateLimit: {
    customRules: {
      '/instance/setup': { window: 60, max: 5 },
      '/account-signup/complete': { window: 60, max: 5 },
      '/account-signup/resend': { window: 60, max: 5 },
      '/account-password/request': { window: 60, max: 5 },
      '/account-password/admin-reset': { window: 60, max: 5 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const response = await administerAccount(ctx);
      if (response) return response;
      // Better Auth cancels the previous link before beforeCreateInvitation runs.
      if (ctx.path === '/organization/invite-member') validateProjectRole(ctx.body?.role);
      if (ctx.path === '/admin/create-user' && ctx.request) {
        if (ctx.body?.password !== undefined)
          throw new APIError('BAD_REQUEST', {
            message: 'Users choose their own password through the signup email.',
          });
        ctx.body.data = { ...ctx.body.data, emailVerified: false };
      }
      return undefined;
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/admin/create-user' || !ctx.request) return;
      const result = ctx.context.returned as
        | { user?: { id: string; email: string; name: string } }
        | undefined;
      if (!result?.user) return;

      let signupEmailSent = false;
      try {
        await sendAccountSignupInvitation(result.user);
        signupEmailSent = true;
      } catch (error) {
        ctx.context.logger.error('Account created, but signup email delivery failed.', error);
      }
      // Preserve account creation on delivery failure; admins can resend without creating a duplicate.
      return ctx.json({ ...result, signupEmailSent });
    }),
  },
  plugins: [admin(), projects, instanceSetup, accountSignup, accountPassword],
});

export default { fetch: auth.handler };
