import { expect, test } from 'vite-plus/test';
import { newRegistryCredentialFormSchema } from '@senv/api/shared/deployment-credentials';
import { toRegistryCredentialInput } from './project-registry-credentials.form';

test('registry credential form applies the same normalized API fields', () => {
  expect(
    toRegistryCredentialInput({
      name: '  Production  ',
      registry: ' ghcr.io ',
      username: '  deployer ',
      secret: 'opaque-token',
    }),
  ).toEqual({
    name: 'Production',
    registry: 'ghcr.io',
    username: 'deployer',
    secret: 'opaque-token',
  });
});

test('registry credential validation maps invalid input to its draft field', () => {
  const result = newRegistryCredentialFormSchema.safeParse({
    name: 'Production',
    registry: 'https://user:password@example.com',
    username: 'deployer',
    secret: '',
  });
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
    'registry',
    'secret',
  ]);
});
