import { expect, test } from 'vite-plus/test';
import {
  adminDeploymentDefaultsDraftValueSchema,
  toInstanceDeploymentDefaults,
} from './admin-deployment-defaults.form';

test('admin defaults draft converts MiB fields to validated API bytes', () => {
  expect(
    toInstanceDeploymentDefaults({
      uploadLimitMiB: 100,
      proxyCpus: ' 0.5 ',
      proxyMemoryMiB: 64,
      logFiles: 3,
      logFileSizeMiB: 10,
    }),
  ).toEqual({
    uploadLimitBytes: 104857600,
    proxyCpus: '0.5',
    proxyMemoryBytes: 67108864,
    logFiles: 3,
    logFileSizeBytes: 10485760,
  });
});

test('admin defaults API validation errors point to their MiB form fields', () => {
  const result = adminDeploymentDefaultsDraftValueSchema.safeParse({
    uploadLimitMiB: 10_241,
    proxyCpus: '129',
    proxyMemoryMiB: 64,
    logFiles: 3,
    logFileSizeMiB: 10,
  });
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
    'uploadLimitMiB',
    'proxyCpus',
  ]);
});
