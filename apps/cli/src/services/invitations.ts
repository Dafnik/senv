import { authRequest, type ClientContext } from '../api/client.ts';
export function decideInvitation(
  value: ClientContext,
  invitationId: string,
  decision: 'accept' | 'reject',
  signal?: AbortSignal,
) {
  return authRequest(
    value.profile.apiUrl,
    `organization/${decision}-invitation`,
    value.token,
    { invitationId },
    {},
    signal,
  );
}
