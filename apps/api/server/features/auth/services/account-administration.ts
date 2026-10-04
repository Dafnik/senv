import { APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import * as z from 'zod';
import { db } from '../../../infrastructure/db';
import {
  countInstanceAdmins,
  deleteAccount,
  findAccount,
  findAccountSession,
  updateAccountRole,
} from '../repositories/accounts';

export const instanceRole = z.enum(['user', 'admin']);

export function validateInstanceRole(value: unknown) {
  if (!instanceRole.safeParse(value).success)
    throw new APIError('BAD_REQUEST', { message: 'Choose one instance role: user or admin.' });
}

// Before hooks have not yet run endpoint validation or authorization.
export async function administerAccount(ctx: Parameters<typeof getAuthoritativeSessionFromCtx>[0]) {
  if (ctx.path === '/admin/set-user-password')
    throw new APIError('FORBIDDEN', { message: 'Send a password reset email instead.' });
  if (ctx.path === '/admin/create-user') {
    if (ctx.body?.role !== undefined) validateInstanceRole(ctx.body.role);
    if (ctx.body?.data?.role !== undefined) validateInstanceRole(ctx.body.data.role);
  }
  if (ctx.path === '/admin/update-user' && ctx.body?.data?.role !== undefined)
    throw new APIError('BAD_REQUEST', {
      message: 'Change instance roles through the set-role endpoint.',
    });
  if (ctx.path !== '/admin/remove-user' && ctx.path !== '/admin/set-role') return;

  const body = z
    .object({
      userId: z.string().min(1),
      ...(ctx.path === '/admin/set-role' ? { role: instanceRole } : {}),
    })
    .safeParse(ctx.body);
  if (!body.success)
    throw new APIError('BAD_REQUEST', {
      message: 'Provide a user ID and one valid instance role.',
    });
  const actor = await getAuthoritativeSessionFromCtx(ctx);
  if (!actor) throw new APIError('UNAUTHORIZED');
  if (actor.user['role'] !== 'admin' || actor.session['impersonatedBy'])
    throw new APIError('FORBIDDEN');
  if (ctx.path === '/admin/remove-user' && body.data.userId === actor.user.id)
    throw new APIError('BAD_REQUEST', { message: 'You cannot delete your own account.' });

  const saved = db.transaction(
    (tx) => {
      const currentActor = findAccount(actor.user.id, tx);
      const currentSession = findAccountSession(tx, actor.session.id);
      if (currentActor?.role !== 'admin' || !currentSession) throw new APIError('FORBIDDEN');
      const target = findAccount(body.data.userId, tx);
      if (!target) throw new APIError('NOT_FOUND', { message: 'User not found.' });
      const role = 'role' in body.data ? (body.data.role as 'user' | 'admin') : undefined;
      if (target.role === 'admin' && role !== 'admin' && countInstanceAdmins(tx)!.total <= 1)
        throw new APIError('FORBIDDEN', {
          message: 'The last instance admin cannot be deleted or demoted. Add another admin first.',
        });
      if (role) return updateAccountRole(tx, target.id, role)!;
      // Foreign-key cascades remove credentials and sessions in this same transaction.
      deleteAccount(tx, target.id);
      return target;
    },
    { behavior: 'immediate' },
  );
  return ctx.json(ctx.path === '/admin/remove-user' ? { success: true } : { user: saved });
}
