export const invitationStatuses = [
  'pending',
  'accepted',
  'rejected',
  'canceled',
  'expired',
] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];
export const invitationSortFields = [
  'email',
  'role',
  'invitedByName',
  'createdAt',
  'expiresAt',
] as const;
export type InvitationSortField = (typeof invitationSortFields)[number];

export function isInvitationSortField(value: string): value is InvitationSortField {
  return invitationSortFields.some((field) => field === value);
}
