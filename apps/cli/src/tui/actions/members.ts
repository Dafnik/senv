import type { ActionHost } from '../controller.ts';

import type { ActionTools } from './index.ts';
export function registerMembers(this: ActionHost, tools: ActionTools) {
  const { add, field, selected, adminOnly } = tools;

  if (selected) {
    add(
      'Change member role',
      () =>
        this.form(
          'Change project role',
          [
            field('role', 'Project role', String(selected.data.role), [
              'viewer',
              'developer',
              'admin',
            ]),
          ],
          async (v, signal) => {
            await this.requestContext(signal).client.projects.changeMemberRole.mutate({
              projectId: this.project!.id,
              memberId: selected.id,
              role: v.role as 'viewer' | 'developer' | 'admin',
            });
          },
        ),
      adminOnly,
    );
    add(
      'Remove member',
      () =>
        this.mutation(
          'Remove project member',
          (v) =>
            v.client.projects.removeMember.mutate({
              projectId: this.project!.id,
              memberId: selected.id,
            }),
          [
            `Member: ${selected.title} (${selected.id})`,
            'This account will lose project membership.',
          ],
        ),
      adminOnly,
    );
  }
}
