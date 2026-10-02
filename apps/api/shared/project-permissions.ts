import { createAccessControl } from 'better-auth/plugins/access';

export const projectAccess = createAccessControl({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
} as const);

export const projectRoles = {
  viewer: projectAccess.newRole({}),
  developer: projectAccess.newRole({}),
  admin: projectAccess.newRole({
    organization: ['update', 'delete'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
  }),
};

export type ProjectRole = keyof typeof projectRoles;
export const projectRoleNames = Object.keys(projectRoles) as ProjectRole[];

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(projectRoles, value);
}
