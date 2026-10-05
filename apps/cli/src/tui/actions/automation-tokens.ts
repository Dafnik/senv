import type { ActionHost } from '../controller.ts';

import { tokenLifetime } from '../../services/tokens.ts';

import type { ActionTools } from './index.ts';
export function registerAutomationTokens(this: ActionHost, tools: ActionTools) {
  const { add, field, selected, personalOnly } = tools;

  add(
    'Create project token',
    () =>
      this.form(
        'Create project token',
        [
          field('name', 'Token name'),
          field('project', 'Project slug or ID', this.project?.id ?? ''),
          field('permission', 'Deployment permission', 'read', ['read', 'manage']),
          field('duration', 'Lifetime (empty means never expires)', '30', undefined, false),
          field('unit', 'Lifetime unit', 'days', ['seconds', 'days', 'months', 'years']),
        ],
        async (v, signal) => {
          const seconds = tokenLifetime(
            v.duration,
            v.unit as 'seconds' | 'days' | 'months' | 'years',
          );
          const ctx = this.requestContext(signal);
          const project = await ctx.client.cli.project.query({ project: v.project! });
          const result = await ctx.client.cli.createToken.mutate({
            projectId: project.id,
            name: v.name!,
            permission: v.permission as 'read' | 'manage',
            expiresInSeconds: seconds,
          });
          this.message(
            'Save this token now. It will not be shown again.',
            [
              result.secret,
              `ID: ${result.id}`,
              `Expires: ${result.expiresAt?.toISOString() ?? 'Never'}`,
              'Leaving this view clears the secret.',
            ],
            true,
          );
        },
      ),
    personalOnly,
  );
  if (selected)
    add(
      'Revoke token',
      () =>
        this.mutation(
          'Revoke automation token',
          (v) => v.client.cli.revokeToken.mutate({ id: selected.id }),
          [
            `Token: ${selected.title} (${selected.id})`,
            'New requests using this token will fail immediately.',
          ],
        ),
      selected.data.revokedAt ? 'Already revoked' : personalOnly,
    );
}
