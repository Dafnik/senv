import type { ActionHost } from '../controller.ts';

import { detailLines } from '../safety.ts';

import type { ActionTools } from './index.ts';
export function registerProjects(this: ActionHost, tools: ActionTools) {
  const { add, field, selected, personalOnly } = tools;

  if (this.personal())
    add('Invitations / look up invitation ID', () => this.navigate('Invitations'));
  add(
    'Create project',
    () =>
      this.form(
        'Create project',
        [
          field('name', 'Project name'),
          field('slug', 'Preview slug (optional)', '', undefined, false),
        ],
        async (v, signal) => {
          const result = await this.requestContext(signal).client.projects.create.mutate({
            name: v.name!,
            previewSlug: v.slug || undefined,
          });
          this.message('Project created', detailLines(result));
        },
      ),
    personalOnly,
  );
  if (selected) add('Show project identity', () => this.update({ detail: selected, scroll: 0 }));
}
