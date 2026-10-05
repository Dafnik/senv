import { closeShells } from '../deployments/services/shell-registry';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, bearer, deviceAuthorization } from 'better-auth/plugins';
import * as schema from '../../../../../drizzle/schema';
import { db } from '../../infrastructure/db';
import env from '../../infrastructure/env';
import { sendEmailVerification } from '../notifications/services/email';
import { projects, validateProjectRole } from '../projects/auth-options';
import { administerAccount } from './services/account-administration';
import { accountPassword } from './services/password-options';
import { instanceSetup } from './services/setup-options';
import { accountSignup, sendAccountSignupInvitation } from './services/signup-options';
import { beforeCliAuth, afterCliAuth } from './services/cli-auth-options';

const authInstance = betterAuth({
  disabledPaths: ['/list-sessions', '/revoke-session', '/admin/list-user-sessions'],
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
  databaseHooks: {
    session: {
      delete: {
        after: async (removed) => {
          await closeShells({ sessionId: removed.id }, 'session_revoked');
        },
      },
    },
    user: {
      delete: {
        after: async (removed) => {
          await closeShells({ userId: removed.id }, 'session_revoked');
        },
      },
      update: {
        after: async (updated, context) => {
          if (context?.path === '/admin/set-role' || context?.path === '/admin/ban-user')
            await closeShells({ userId: updated.id }, 'permission_lost');
        },
      },
    },
  },
  emailAndPassword: { enabled: true, disableSignUp: true, revokeSessionsOnPasswordReset: true },
  emailVerification: {
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailVerification({ to: user.email, name: user.name, url });
    },
  },
  rateLimit: {
    enabled: true,
    customRules: {
      '/instance/setup': { window: 60, max: 5 },
      '/account-signup/complete': { window: 60, max: 5 },
      '/account-signup/resend': { window: 60, max: 5 },
      '/account-password/request': { window: 60, max: 5 },
      '/account-password/admin-reset': { window: 60, max: 5 },
      '/device': { window: 60, max: 20 },
      '/device/code': { window: 60, max: 10 },
      '/device/token': { window: 60, max: 30 },
      '/device/approve': { window: 60, max: 10 },
      '/device/deny': { window: 60, max: 10 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      await beforeCliAuth(ctx);
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
      await afterCliAuth(ctx);
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
  plugins: [
    admin(),
    projects,
    instanceSetup,
    accountSignup,
    accountPassword,
    bearer(),
    deviceAuthorization({
      verificationUri: new URL('/cli/authorize', env.APP_URL).href,
      validateClient: (id) => id === 'senv-cli',
      expiresIn: '10m',
      interval: '5s',
    }),
  ],
});

// Keep the internal session API available, but never publish session bearer material
// to browser JavaScript. Device redemption is the sole bearer issuance endpoint.
export const auth = {
  ...authInstance,
  handler: async (request: Request) => {
    const authorization = request.headers.get('authorization');
    if (authorization !== null) {
      if (!/^Bearer \S+$/i.test(authorization))
        return new Response('Invalid bearer credential.', { status: 401 });
      const headers = new Headers(request.headers);
      headers.delete('cookie');
      request = new Request(request, { headers });
    }
    const response = await authInstance.handler(request);
    const headers = new Headers(response.headers);
    headers.delete('set-auth-token');
    const exposed = headers
      .get('access-control-expose-headers')
      ?.split(',')
      .map((v) => v.trim())
      .filter((v) => v.toLowerCase() !== 'set-auth-token');
    if (exposed?.length) headers.set('access-control-expose-headers', exposed.join(', '));
    else headers.delete('access-control-expose-headers');
    if (
      !new URL(request.url).pathname.endsWith('/device/token') &&
      headers.get('content-type')?.includes('application/json')
    ) {
      const redact = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== 'token')
              .map(([key, item]) => [key, redact(item)]),
          );
        return value;
      };
      const value = await response
        .clone()
        .json()
        .catch(() => undefined);
      if (value === undefined)
        return new Response(response.body, { status: response.status, headers });
      headers.delete('content-length');
      return new Response(JSON.stringify(redact(value)), { status: response.status, headers });
    }
    return new Response(response.body, { status: response.status, headers });
  },
};
export default { fetch: auth.handler };
