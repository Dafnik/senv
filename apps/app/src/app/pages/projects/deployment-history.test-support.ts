import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { TrpcService } from '../../trpc/trpc.service';
import { DeploymentHistory } from './deployment-history';

export const session = signal({
  data: { session: { id: 'session-id' }, user: { id: 'user-id' } },
});
export const queryAudit = vi.fn();
export let queryClient: QueryClient;

export const entry = {
  id: 'audit-entry-1',
  projectId: 'project-id',
  deploymentId: 'deployment-123456',
  event: 'deleted',
  actorType: 'user' as const,
  actor: { id: 'actor-id', name: 'Ada Admin' },
  details: { reason: 'retention' },
  createdAt: new Date('2026-09-10T10:00:00.000Z'),
};

export function setupDeploymentHistoryTests() {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    session.set({
      data: { session: { id: 'session-id' }, user: { id: 'user-id' } },
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    TestBed.configureTestingModule({
      providers: [
        provideTanStackQuery(() => queryClient),
        { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
        {
          provide: TrpcService,
          useValue: {
            client: { deployments: { audit: { query: queryAudit } } },
          },
        },
      ],
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
  });
}

export function createHistory(deploymentId?: string) {
  const fixture = TestBed.createComponent(DeploymentHistory);
  fixture.componentRef.setInput('projectId', 'project-id');
  fixture.componentRef.setInput('deploymentId', deploymentId);
  return fixture;
}

export async function selectOption(
  fixture: ReturnType<typeof createHistory>,
  kind: 'event' | 'actor',
  optionText: string,
) {
  const id =
    kind === 'event'
      ? fixture.componentInstance.eventSelectId()
      : fixture.componentInstance.actorSelectId();
  const trigger = fixture.nativeElement.querySelector(
    `button#${id}`,
  ) as HTMLButtonElement;
  trigger.click();
  fixture.detectChanges();
  await fixture.whenStable();
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
  ).find((element) => element.textContent?.trim() === optionText);
  if (!option) throw new Error(`Could not find select option: ${optionText}`);
  option.click();
  fixture.detectChanges();
  await fixture.whenStable();
}
