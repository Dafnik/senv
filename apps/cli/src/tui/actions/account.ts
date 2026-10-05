import type { ActionHost } from '../controller.ts';

import type { ActionTools } from './index.ts';
export function registerAccount(this: ActionHost, tools: ActionTools) {
  const { add, personalOnly } = tools;

  if (!this.context)
    add('Retry connection', () => {
      void this.connect();
    });
  add(
    'Log in / switch account',
    () => this.loginForm(),
    process.env['SENV_TOKEN'] ? 'Unset SENV_TOKEN first' : undefined,
  );
  if (this.context) {
    for (const localOnly of [false, true])
      add(
        localOnly ? 'Local-only logout (server session stays active)' : 'Logout and revoke session',
        () => {
          this.confirm(
            'Sign out?',
            [
              localOnly
                ? 'Only the local credential will be removed. The server session remains active.'
                : 'The current CLI session will be revoked on the server.',
            ],
            () => {
              void this.perform('Logout', async () => {
                await this.deps.logout(this.requireContext(), localOnly);
                this.clearAccount('Signed out.');
              });
            },
          );
        },
        process.env['SENV_TOKEN'] ? 'Unset or revoke SENV_TOKEN instead' : personalOnly,
      );
    add('Open browser profile / password recovery', () => {
      void this.openProfile();
    });
  }
}
