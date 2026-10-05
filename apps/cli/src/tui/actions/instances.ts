import type { ActionHost } from '../controller.ts';

import { instancesService } from '../../services/instances.ts';

import type { ActionTools } from './index.ts';
export function registerInstances(this: ActionHost, tools: ActionTools) {
  const { add, field, selected } = tools;

  add('Add instance profile', () =>
    this.form(
      'Add instance profile',
      [field('name', 'Profile name'), field('apiUrl', 'API origin', 'http://localhost:3000')],
      async (v, signal) => {
        await instancesService(this.deps).add(v.name!, v.apiUrl!, signal);
        await this.showInstances();
      },
      false,
    ),
  );
  if (selected)
    add('Use this instance', () => {
      void this.switchInstance(selected.id);
    });
  add('Login to an instance', () => this.loginForm());
}
