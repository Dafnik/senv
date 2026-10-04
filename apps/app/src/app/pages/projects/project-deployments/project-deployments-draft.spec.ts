import { expect, test } from 'vite-plus/test';
import {
  restorePublishDraft,
  type PublishDraft,
} from './project-deployments.form';

const defaults: PublishDraft = {
  kind: 'static',
  image: '',
  registryCredentialId: '',
  pinned: false,
  commit: '',
  branch: '',
  port: 80,
  reuseDeploymentId: '',
};

test('publication draft restoration keeps valid incomplete fields and migrates the legacy reuse key', () => {
  expect(
    restorePublishDraft(
      {
        kind: 'container',
        image: '',
        branch: 'feature/unfinished',
        pinned: true,
        reuseArtifactId: 'deployment-a',
      },
      defaults,
    ),
  ).toEqual({
    ...defaults,
    kind: 'container',
    branch: 'feature/unfinished',
    pinned: true,
    reuseDeploymentId: 'deployment-a',
  });
});

test('malformed publication drafts safely fall back to defaults', () => {
  expect(
    restorePublishDraft(
      { kind: 'not-a-kind', port: 'not-a-number', branch: ['wrong-shape'] },
      defaults,
    ),
  ).toEqual(defaults);
  expect(restorePublishDraft([], defaults)).toEqual(defaults);
});
