import { expect, test } from 'vite-plus/test';
import { isPermanentInvitationError } from './invitation-error';

test('only expired or invalid invitation codes get terminal copy', () => {
  expect(isPermanentInvitationError({ data: { code: 'NOT_FOUND' } })).toBe(
    true,
  );
  expect(isPermanentInvitationError({ data: { code: 'BAD_REQUEST' } })).toBe(
    true,
  );
  expect(
    isPermanentInvitationError({ data: { code: 'INTERNAL_SERVER_ERROR' } }),
  ).toBe(false);
  expect(isPermanentInvitationError(new Error('offline'))).toBe(false);
});
