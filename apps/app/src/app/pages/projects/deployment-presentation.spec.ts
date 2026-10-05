import { expect, test } from 'vite-plus/test';
import { canReuseDeployment } from './deployment-presentation';

function reusableDeployment(
  overrides: Partial<Parameters<typeof canReuseDeployment>[0]> = {},
): Parameters<typeof canReuseDeployment>[0] {
  return {
    kind: 'static',
    artifactId: 'artifact-retained',
    imageDigest: null,
    status: 'healthy',
    removalPending: false,
    ...overrides,
  };
}

test('retained artifacts and image digests can be reused across active statuses', () => {
  expect(
    canReuseDeployment(
      reusableDeployment({ status: 'failed', artifactId: 'artifact-retained' }),
    ),
  ).toBe(true);
  expect(
    canReuseDeployment(
      reusableDeployment({ status: 'queued', artifactId: 'artifact-retained' }),
    ),
  ).toBe(true);
  expect(
    canReuseDeployment(
      reusableDeployment({
        kind: 'container',
        artifactId: null,
        imageDigest: 'sha256:retained',
        status: 'failed',
      }),
    ),
  ).toBe(true);
});

test('missing retained content and terminal or removing deployments cannot be reused', () => {
  expect(canReuseDeployment(reusableDeployment({ artifactId: null }))).toBe(
    false,
  );
  expect(
    canReuseDeployment(
      reusableDeployment({ kind: 'container', imageDigest: null }),
    ),
  ).toBe(false);
  expect(canReuseDeployment(reusableDeployment({ status: 'deleted' }))).toBe(
    false,
  );
  expect(canReuseDeployment(reusableDeployment({ status: 'cleaned' }))).toBe(
    false,
  );
  expect(canReuseDeployment(reusableDeployment({ removalPending: true }))).toBe(
    false,
  );
});
