export function isPermanentInvitationError(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  return code === 'NOT_FOUND' || code === 'BAD_REQUEST';
}
