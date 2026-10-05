import type { ActionHost } from '../controller.ts';

import { row } from '../workspace.ts';
import { detailLines } from '../safety.ts';

import { decideInvitation } from '../../services/invitations.ts';

import type { ActionTools } from './index.ts';
export function registerInvitations(this: ActionHost, tools: ActionTools) {
  const { add, field, selected, adminOnly } = tools;

  add('Look up invitation ID', () =>
    this.form(
      'Inspect invitation',
      [field('id', 'Invitation ID')],
      async (v, signal) => {
        const result = await this.requestContext(signal).client.projects.invitation.query({
          invitationId: v.id!,
        });
        const invitation = row(v.id!, result.organizationName, `Invited role: ${result.role}`, {
          ...result,
          recipient: true,
        });
        this.update({ detail: invitation, scroll: 0 });
      },
      false,
    ),
  );
  add(
    'Create project invitation',
    () =>
      this.form(
        'Create project invitation',
        [
          field('email', 'Email address'),
          field('role', 'Project role', 'viewer', ['viewer', 'developer', 'admin']),
        ],
        async (v, signal) => {
          const result = await this.requestContext(signal).client.projects.invite.mutate({
            projectId: this.project!.id,
            email: v.email!,
            role: v.role as 'viewer' | 'developer' | 'admin',
          });
          this.message('Invitation result', detailLines(result));
        },
      ),
    adminOnly,
  );
  if (selected) {
    if (selected.data.recipient)
      for (const operation of ['accept', 'reject'] as const)
        add(`${operation} invitation`, () =>
          this.mutation(`${operation} invitation`, (v, signal) =>
            decideInvitation(v, selected.id, operation, signal),
          ),
        );
    else
      add(
        'Cancel invitation',
        () =>
          this.mutation(
            'Cancel invitation',
            (v) =>
              v.client.projects.cancelInvitation.mutate({
                projectId: this.project!.id,
                invitationId: selected.id,
              }),
            [`Invitation: ${selected.title} (${selected.id})`],
          ),
        adminOnly,
      );
  }
  if (!this.identity?.emailVerified)
    add('Open browser for email verification', () => {
      void this.openProfile();
    });
}
