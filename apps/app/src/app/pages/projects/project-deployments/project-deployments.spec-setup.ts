import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, vi } from 'vite-plus/test';
import { By } from '@angular/platform-browser';
import type { DeploymentActions } from '../deployment-actions';
import { DeploymentList } from '../deployment-list';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { DeploymentUpload } from '../../../queries/deployment-upload';
import { DeploymentsData } from '../../../queries/deployments';
import { ProjectDeployments } from './project-deployments';
import {
  localStorageMock,
  session,
  storage,
} from './project-deployments.spec-data';
import { mock, upload } from './project-deployments.spec-mocks';
import { TestResizeObserver } from '../test-resize-observer';
export function createFixture(
  canManage = true,
  isAdmin = false,
  redeployId = '',
) {
  const fixture = TestBed.createComponent(ProjectDeployments);
  fixture.componentRef.setInput('projectId', 'project-a');
  fixture.componentRef.setInput('previewSlug', 'project');
  fixture.componentRef.setInput('canManage', canManage);
  fixture.componentRef.setInput('isAdmin', isAdmin);
  fixture.componentRef.setInput('redeployId', redeployId);
  return fixture;
}

export function setupProjectDeploymentTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    session.set({
      data: {
        session: { id: 'session-a' },
        user: { id: 'developer-id', role: 'user' },
      },
    });
    TestBed.configureTestingModule({
      imports: [ProjectDeployments],
      providers: [
        provideRouter([]),
        provideTanStackQuery(
          () =>
            new QueryClient({ defaultOptions: { queries: { retry: false } } }),
        ),
        { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
        { provide: DeploymentsData, useValue: mock },
        { provide: DeploymentUpload, useValue: upload },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    storage.clear();
    vi.unstubAllGlobals();
  });
}

export function display(
  fixture: ComponentFixture<ProjectDeployments>,
): DeploymentActions {
  return fixture.debugElement.query(By.directive(DeploymentList))
    .componentInstance.actions;
}
