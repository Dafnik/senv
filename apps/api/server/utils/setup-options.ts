import { randomUUID } from 'node:crypto';
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import {
  accountNameMaxLength,
  passwordMaxLength,
  passwordMinLength,
} from '../../shared/validation';
import { account, user } from '../../../../drizzle/schema';
import { db } from './db';

export function hasInstanceAdmin(database: Pick<typeof db, 'select'> = db) {
  return !!database
    .select({ id: user.id })
    .from(user)
    .where(sql`instr(',' || coalesce(${user.role}, '') || ',', ',admin,') > 0`)
    .limit(1)
    .get();
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
          name: z.string().trim().min(1).max(accountNameMaxLength),
          email: z.string().trim().toLowerCase().pipe(z.email()),
          password: z.string().min(passwordMinLength).max(passwordMaxLength),
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
            if (
              tx
                .select({ id: user.id })
                .from(user)
                .where(sql`lower(${user.email}) = ${ctx.body.email}`)
                .get()
            ) {
              throw new APIError('CONFLICT', {
                message: 'An account with this email already exists.',
              });
            }
            const id = randomUUID();
            tx.insert(user)
              .values({
                id,
                name: ctx.body.name,
                email: ctx.body.email,
                role: 'admin',
                emailVerified: true,
              })
              .run();
            tx.insert(account)
              .values({
                id: randomUUID(),
                userId: id,
                accountId: id,
                providerId: 'credential',
                password,
              })
              .run();
          },
          { behavior: 'immediate' },
        );
        return ctx.json({ status: true });
      },
    ),
  },
};
