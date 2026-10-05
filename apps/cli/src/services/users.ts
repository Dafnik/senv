import { authRequest, type ClientContext } from '../api/client.ts';
const endpoints = {
  create: 'admin/create-user',
  role: 'admin/set-role',
  delete: 'admin/remove-user',
  resendSignup: 'account-signup/resend',
  resetPassword: 'account-password/admin-reset',
};
export function userOperation(
  value: ClientContext,
  operation: keyof typeof endpoints,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return authRequest(value.profile.apiUrl, endpoints[operation], value.token, body, {}, signal);
}
