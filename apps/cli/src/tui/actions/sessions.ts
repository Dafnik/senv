import type { ActionHost } from '../controller.ts';

import { removeCredential } from '../../profiles.ts';

import type { ActionTools } from './index.ts';
export function registerSessions(this: ActionHost, tools: ActionTools) {
  const { add, selected, personalOnly } = tools;

  if (selected)
    add(
      'Revoke this session',
      () =>
        this.confirm(
          'Revoke session?',
          [
            `${selected.title} (${selected.id})`,
            selected.data.current
              ? 'This is the current session. You will be signed out.'
              : 'That browser or terminal will lose access.',
          ],
          () => {
            void this.perform('Revoke session', async (signal) => {
              await this.requestContext(signal).client.cli.revokeSession.mutate({
                id: selected.id,
              });
              if (selected.data.current) {
                const ctx = this.requireContext();
                if (!process.env['SENV_TOKEN'])
                  await removeCredential(ctx.configuration, ctx.name, ctx.profile);
                this.clearAccount('Current session revoked.');
              }
            });
          },
        ),
      personalOnly,
    );
  add(
    'Revoke all other sessions',
    () =>
      this.mutation('Revoke other sessions', (v) => v.client.cli.revokeOtherSessions.mutate(), [
        'All other browser and CLI sessions for this account will be signed out.',
      ]),
    personalOnly,
  );
}
