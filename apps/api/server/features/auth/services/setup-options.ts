import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api';
import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import {
  accountNameSchema,
  accountPasswordSchema,
  emailAddressSchema,
} from '../../../../shared/validation';
import { db } from '../../../infrastructure/db';
import {
  findAccountEmailConflict,
  findInstanceAdmin,
  insertAccount,
  insertCredential,
} from '../repositories/accounts';

export function hasInstanceAdmin(database: Pick<typeof db, 'select'> = db) {
  return !!findInstanceAdmin(database);
}

export const instanceSetup = {
  id: 'instance-setup',
  endpoints: {
    setupStatus: createAuthEndpoint('/instance/setup-status', { method: 'GET' }, async (ctx) => {
      ctx.setHeader('Cache-Control', 'no-store');
      return ctx.json({ needsSetup: !hasInstanceAdmin() });
    }),
    setupInstance: createAuthEndpoint(
      '/instance/setup',
      {
        method: 'POST',
        use: [formCsrfMiddleware],
        body: z.object({
          name: accountNameSchema,
          email: emailAddressSchema,
          password: accountPasswordSchema,
        }),
      },
      async (ctx) => {
        if (hasInstanceAdmin()) {
          throw new APIError('FORBIDDEN', { message: 'Instance setup is already complete.' });
        }
        const password = await ctx.context.password.hash(ctx.body.password);
        // Password hashing is asynchronous; recheck under SQLite's write lock.
        // Keep both inserts synchronous so failed creation rolls back completely.
        db.transaction(
          (tx) => {
            if (hasInstanceAdmin(tx)) {
              throw new APIError('FORBIDDEN', { message: 'Instance setup is already complete.' });
            }
            if (findAccountEmailConflict(tx, ctx.body.email)) {
              throw new APIError('CONFLICT', {
                message: 'An account with this email already exists.',
              });
            }
            const id = randomUUID();
            insertAccount(tx, {
              id,
              name: ctx.body.name,
              email: ctx.body.email,
              role: 'admin',
              emailVerified: true,
            });
            insertCredential(tx, {
              id: randomUUID(),
              userId: id,
              accountId: id,
              providerId: 'credential',
              password,
            });
          },
          { behavior: 'immediate' },
        );
        return ctx.json({ status: true });
      },
    ),
  },
};
