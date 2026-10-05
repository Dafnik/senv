import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { DeploymentConfiguration } from './deployment-configuration';

const deployment: PublicDeployment = {
  id: 'deployment-123456',
  projectId: 'project-id',
  kind: 'static',
  status: 'failed',
  removalPending: false,
  configurationOutdated: false,
  configurationChanges: [],
  previewUrl: 'https://preview.example.test',
  desiredState: 'running',
  pinned: false,
  artifactId: 'artifact-retained',
  imageDigest: null,
  source: {},
  submittedAt: new Date('2026-09-01T00:00:00.000Z'),
  readyAt: null,
  retentionStartedAt: null,
  retentionDeadlineAt: null,
  failureReason: null,
  config: {
    retentionDays: 7,
    port: 80,
    env: {},
    spaFallback: false,
    health: {
      path: '/',
      startupDeadlineSeconds: 120,
      intervalSeconds: 30,
      timeoutSeconds: 5,
      unhealthyThreshold: 3,
    },
    proxy: {
      routes: [],
      cacheRules: [],
      compression: { enabled: false, endings: [] },
    },
    limits: {
      origin: { cpus: '1', memoryBytes: 256 * 1024 * 1024 },
      proxy: { cpus: '1', memoryBytes: 256 * 1024 * 1024 },
    },
    logs: { files: 2, fileSizeBytes: 1024 },
    secretNames: [],
    hasSecrets: false,
  },
  branchAlias: null,
  tags: [],
};

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
});

afterEach(() => TestBed.resetTestingModule());

function createConfiguration(
  item: PublicDeployment = deployment,
  canManage = true,
) {
  const fixture = TestBed.createComponent(DeploymentConfiguration);
  fixture.componentRef.setInput('deployment', item);
  fixture.componentRef.setInput('projectSlug', 'demo-project');
  fixture.componentRef.setInput('canManage', canManage);
  fixture.detectChanges();
  return fixture;
}

test('developers can start a new publication from a retained failed artifact', () => {
  const fixture = createConfiguration();
  const link = fixture.nativeElement.querySelector(
    'a[hlmBtn]',
  ) as HTMLAnchorElement | null;
  expect(link?.textContent).toContain('Redeploy');
  expect(link?.getAttribute('href')).toBe(
    '/projects/demo-project/deployments?redeploy=deployment-123456',
  );
});

test('the redeploy shortcut is hidden for viewers, removed deployments, or missing artifacts', () => {
  expect(
    createConfiguration(deployment, false).nativeElement.querySelector(
      'a[hlmBtn]',
    ),
  ).toBeNull();
  expect(
    createConfiguration({
      ...deployment,
      status: 'deleted',
    }).nativeElement.querySelector('a[hlmBtn]'),
  ).toBeNull();
  expect(
    createConfiguration({
      ...deployment,
      removalPending: true,
    }).nativeElement.querySelector('a[hlmBtn]'),
  ).toBeNull();
  expect(
    createConfiguration({
      ...deployment,
      artifactId: null,
    }).nativeElement.querySelector('a[hlmBtn]'),
  ).toBeNull();
});
