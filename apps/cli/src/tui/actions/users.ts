import type { ActionHost } from '../controller.ts';

import { detailLines } from '../safety.ts';

import { userOperation } from '../../services/users.ts';

import type { ActionTools } from './index.ts';
export function registerUsers(this: ActionHost, tools: ActionTools) {
  const { add, field, selected } = tools;

  add('Create user and send signup email', () =>
    this.form(
      'Create user',
      [field('name', 'Name'), field('email', 'Email address')],
      async (v, signal) => {
        const ctx = this.requireContext();
        const result = await userOperation(
          ctx,
          'create',
          { name: v.name, email: v.email, role: 'user' },
          signal,
        );
        this.message('Account creation / email result', detailLines(result));
      },
    ),
  );
  if (selected) {
    add('Change instance role', () =>
      this.form(
        'Change instance role',
        [field('role', 'Instance role', String(selected.data.role ?? 'user'), ['user', 'admin'])],
        async (v, signal) => {
          const ctx = this.requireContext();
          await userOperation(ctx, 'role', { userId: selected.id, role: v.role }, signal);
        },
      ),
    );
    add('Delete user', () =>
      this.mutation(
        'Delete user',
        (v, signal) => userOperation(v, 'delete', { userId: selected.id }, signal),
        [
          `User: ${selected.title} (${selected.id})`,
          'This permanently removes the account. Server admin safeguards still apply.',
        ],
      ),
    );
    for (const [label, endpoint] of [
      ['Resend signup email', 'resendSignup'],
      ['Send password reset email', 'resetPassword'],
    ] as const)
      add(label, () =>
        this.mutation(label, (v, signal) =>
          userOperation(v, endpoint, { userId: selected.id }, signal),
        ),
      );
  }
}
