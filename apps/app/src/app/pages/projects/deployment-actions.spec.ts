import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { deploymentTagNameSchema } from '@senv/api/shared/deployment-tags';
import { toast } from '@spartan-ng/brain/sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { DeploymentsData } from '../../queries/deployments';
import { DeploymentActions } from './deployment-actions';

const session = signal({
  data: { session: { id: 'session-id' }, user: { id: 'user-id' } },
});
const assignTag = vi.fn();
const invalidate = vi.fn();
const deployment = { id: 'deployment-id' } as PublicDeployment;

beforeEach(() => {
  vi.resetAllMocks();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AUTH_CLIENT,
        useValue: { useSession: () => session },
      },
      {
        provide: DeploymentsData,
        useValue: { assignTag, invalidate },
      },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

function createActions() {
  return TestBed.runInInjectionContext(
    () => new DeploymentActions(signal('project-id')),
  );
}

function submitEvent() {
  return { preventDefault: vi.fn() } as unknown as Event;
}

test('tag drafts use the shared DNS label schema and preserve the invalid tag message', async () => {
  const actions = createActions();
  const errorToast = vi.spyOn(toast, 'error');
  actions.tagDrafts.set({ [deployment.id]: ' br-release ' });

  await actions.assignTag(submitEvent(), deployment);

  expect(deploymentTagNameSchema.safeParse('br-release').success).toBe(false);
  expect(assignTag).not.toHaveBeenCalled();
  expect(errorToast).toHaveBeenCalledWith(
    'Enter a lowercase DNS-safe tag. The br- prefix is reserved.',
  );
});

test('valid tag drafts are trimmed and normalized before assignment', async () => {
  assignTag.mockResolvedValue(undefined);
  invalidate.mockResolvedValue(undefined);
  const actions = createActions();
  actions.tagDrafts.set({ [deployment.id]: ' Preview-Canary ' });

  await actions.assignTag(submitEvent(), deployment);

  expect(deploymentTagNameSchema.safeParse('preview-canary').success).toBe(
    true,
  );
  expect(assignTag).toHaveBeenCalledWith(
    'project-id',
    'preview-canary',
    deployment.id,
  );
  expect(actions.tagDrafts()[deployment.id]).toBe('');
});
