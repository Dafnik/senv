import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import env from './env';
import { projects, validateProjectRole } from './project-options';
import { instanceSetup } from './setup-options';
import { sendEmailVerification } from './email';
import * as schema from '../../../../drizzle/schema';
import { db } from './db';

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
  emailAndPassword: { enabled: true, disableSignUp: true },
  emailVerification: {
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailVerification({ to: user.email, name: user.name, url });
    },
  },
  rateLimit: {
    customRules: { '/instance/setup': { window: 60, max: 5 } },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Better Auth cancels the previous link before beforeCreateInvitation runs.
      if (ctx.path === '/organization/invite-member') validateProjectRole(ctx.body?.role);
    }),
  },
  plugins: [admin(), projects, instanceSetup],
});

export default { fetch: auth.handler };
