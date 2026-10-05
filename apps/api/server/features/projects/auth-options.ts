import { APIError } from 'better-auth/api';
import { organization } from 'better-auth/plugins';
import { customAlphabet } from 'nanoid';
import { deploymentSettingsSchema, isValidPreviewHostname } from '../../../shared/deployments';
import { isProjectRole, projectAccess, projectRoles } from '../../../shared/project-permissions';
import { previewSlugSchema, projectNameSchema } from '../../../shared/validation';
import { db } from '../../infrastructure/db';
import { findAccount } from '../auth/repositories/accounts';
import { sendProjectInvitation } from '../notifications/services/email';
import { initializeProjectDeploymentSettings } from './repositories/deployment-settings';
import { findProjectByPreviewSlug, recordProjectMemberInviter } from './repositories/projects';

// Excludes 0/o, 1/i/l, 2/z, 5/s, 8/b and all uppercase characters.
const projectId = customAlphabet('acdefghjkmnpqrtuvwxy34679', 21);
export const invitationExpiresIn = 7 * 24 * 60 * 60;

export function normalizePreviewSlug(value: string) {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/g, '') || 'project'
  );
}

function previewSlug(value: unknown, name: string) {
  const candidate = value === undefined ? normalizePreviewSlug(name) : value;
  const parsed = previewSlugSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new APIError('BAD_REQUEST', {
      message:
        'Preview slugs must be lowercase DNS labels with letters, digits, and internal hyphens.',
    });
  }
  if (findProjectByPreviewSlug(parsed.data)) {
    throw new APIError('BAD_REQUEST', { message: 'That preview slug is already in use.' });
  }
  return parsed.data;
}

export function suggestUniquePreviewSlug(name: string) {
  const base = normalizePreviewSlug(name);
  let candidate = base;
  let suffix = 2;
  while (findProjectByPreviewSlug(candidate)) {
    const tail = `-${suffix++}`;
    candidate = `${base.slice(0, 63 - tail.length).replace(/-+$/g, '')}${tail}`;
  }
  return candidate;
}

function projectName(value: unknown) {
  const parsed = projectNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError('BAD_REQUEST', {
      message: 'Project names must contain 1 to 100 characters.',
    });
  }
  return parsed.data;
}

export function validateProjectRole(role: unknown) {
  if (!isProjectRole(role)) {
    throw new APIError('BAD_REQUEST', { message: 'Choose viewer, developer, or admin.' });
  }
}

export const projects = organization({
  ac: projectAccess,
  roles: projectRoles,
  creatorRole: 'admin',
  invitationExpiresIn,
  requireEmailVerificationOnInvitation: true,
  schema: {
    organization: {
      additionalFields: {
        previewSlug: { type: 'string', required: false, input: true },
      },
    },
  },
  cancelPendingInvitationsOnReInvite: true,
  organizationHooks: {
    beforeCreateOrganization: async ({ organization }) => {
      const id = projectId();
      const name = projectName(organization.name);
      const requested = (organization as typeof organization & { previewSlug?: unknown })
        .previewSlug;
      const candidate =
        requested === undefined ? suggestUniquePreviewSlug(name) : previewSlug(requested, name);
      if (
        !isValidPreviewHostname(
          candidate,
          'a'.repeat(63),
          process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
        )
      )
        throw new APIError('BAD_REQUEST', {
          message:
            'The configured preview domain leaves no room for valid deployment, branch, and tag labels.',
        });
      return { data: { ...organization, id, slug: id, name, previewSlug: candidate } };
    },
    beforeUpdateOrganization: async ({ organization }) => {
      // Slugs are internal aliases of immutable project IDs, not user-chosen names.
      if (organization.slug !== undefined) {
        throw new APIError('BAD_REQUEST', { message: 'Project IDs cannot be changed.' });
      }
      if ('previewSlug' in organization) {
        throw new APIError('BAD_REQUEST', { message: 'Use the project preview-slug setting.' });
      }
      return {
        data: {
          ...organization,
          ...(organization.name !== undefined ? { name: projectName(organization.name) } : {}),
        },
      };
    },
    afterCreateOrganization: async ({ organization }) => {
      const defaults = deploymentSettingsSchema.parse({});
      initializeProjectDeploymentSettings(db, organization.id, defaults);
    },
    beforeAddMember: async ({ member }) => validateProjectRole(member.role),
    beforeUpdateMemberRole: async ({ newRole }) => validateProjectRole(newRole),
    afterAcceptInvitation: async ({ invitation, member }) => {
      const inviter = findAccount(invitation.inviterId);
      recordProjectMemberInviter(member.id, inviter);
    },
    beforeCreateInvitation: async ({ invitation }) => validateProjectRole(invitation.role),
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
