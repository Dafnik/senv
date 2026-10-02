import { createAccessControl } from 'better-auth/plugins/access';

export const projectAccess = createAccessControl({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
} as const);

export const projectRoles = {
  admin: projectAccess.newRole({
    organization: ['update', 'delete'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
  }),
  developer: projectAccess.newRole({}),
  viewer: projectAccess.newRole({}),
};

export type ProjectRole = keyof typeof projectRoles;
