import { APIError } from 'better-auth/api';
import { organization } from 'better-auth/plugins';
import { customAlphabet } from 'nanoid';
import { projectAccess, projectRoles } from '../../shared/project-permissions';
import { sendProjectInvitation } from './email';

// Excludes 0/o, 1/i/l, 2/z, 5/s, 8/b and all uppercase characters.
const projectId = customAlphabet('acdefghjkmnpqrtuvwxy34679', 21);
export const invitationExpiresIn = 7 * 24 * 60 * 60;

function projectName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw new APIError('BAD_REQUEST', {
      message: 'Project names must contain 1 to 100 characters.',
    });
  }
  return value.trim();
}

function validateRole(role: string) {
  if (!Object.prototype.hasOwnProperty.call(projectRoles, role)) {
    throw new APIError('BAD_REQUEST', { message: 'Choose viewer, developer, or admin.' });
  }
}

export const projects = organization({
  ac: projectAccess,
  roles: projectRoles,
  creatorRole: 'admin',
  invitationExpiresIn,
  requireEmailVerificationOnInvitation: true,
  cancelPendingInvitationsOnReInvite: true,
  organizationHooks: {
    beforeCreateOrganization: async ({ organization }) => {
      const id = projectId();
      return { data: { ...organization, id, slug: id, name: projectName(organization.name) } };
    },
    beforeUpdateOrganization: async ({ organization }) => {
      // Slugs are internal aliases of immutable project IDs, not user-chosen names.
      if (organization.slug !== undefined) {
        throw new APIError('BAD_REQUEST', { message: 'Project IDs cannot be changed.' });
      }
      return {
        data: {
          ...organization,
          ...(organization.name !== undefined ? { name: projectName(organization.name) } : {}),
        },
      };
    },
    beforeAddMember: async ({ member }) => validateRole(member.role),
    beforeUpdateMemberRole: async ({ newRole }) => validateRole(newRole),
    beforeCreateInvitation: async ({ invitation }) => validateRole(invitation.role),
  },
  sendInvitationEmail: async ({ id, email, role, organization, inviter, invitation }) => {
    await sendProjectInvitation({
      invitationId: id,
      to: email,
      role,
      projectName: organization.name,
      inviterName: inviter.user.name,
      expiresAt: invitation.expiresAt,
    });
  },
});
