import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { DeploymentsData } from '../../../queries/deployments';
import { ProjectRuntimeSettings } from './project-runtime-settings';

const session = signal({
  data: {
    session: { id: 'runtime-session' },
    user: { id: 'developer', role: 'user' },
  },
});
const runtime = { env: { PUBLIC_MODE: 'preview' }, secretNames: ['API_TOKEN'] };
const data = {
  runtime: vi.fn(() => ({
    queryKey: ['runtime-settings'],
    queryFn: async () => runtime,
  })),
  updateRuntime: vi.fn(async () => runtime),
  invalidate: vi.fn(async () => undefined),
};
beforeEach(() => {
  vi.clearAllMocks();
  TestBed.configureTestingModule({
    imports: [ProjectRuntimeSettings],
    providers: [
      provideTanStackQuery(
        () =>
          new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      ),
      { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
      { provide: DeploymentsData, useValue: data },
    ],
  });
});
afterEach(() => TestBed.resetTestingModule());
function fixture() {
  const fixture = TestBed.createComponent(ProjectRuntimeSettings);
  fixture.componentRef.setInput('projectId', 'runtime-project');
  fixture.componentRef.setInput('canManage', true);
  return fixture;
}
test('saved secrets stay hidden and editing only sends replacement values', async () => {
  const view = fixture();
  await view.whenStable();
  const component = view.componentInstance;
  const input = view.nativeElement.querySelector(
    '#project-secret-value-0',
  ) as HTMLInputElement;
  expect(input.type).toBe('password');
  expect(input.value).toBe('');
  component.setEnv({
    target: { value: 'PUBLIC_MODE=next' },
  } as unknown as Event);
  await component.save(new Event('submit'));
  await view.whenStable();
  expect(data.updateRuntime).toHaveBeenCalledWith('runtime-project', {
    env: { PUBLIC_MODE: 'next' },
    secrets: {},
    removeSecretNames: [],
  });
  component.editSecret(0, 'value', {
    target: { value: 'new-private-value' },
  } as unknown as Event);
  await component.save(new Event('submit'));
  await view.whenStable();
  expect(data.updateRuntime).toHaveBeenLastCalledWith('runtime-project', {
    env: { PUBLIC_MODE: 'preview' },
    secrets: { API_TOKEN: 'new-private-value' },
    removeSecretNames: [],
  });
  expect(component.secrets()[0]?.value).toBe('');
});
test('discard restores project values and duplicate variable or secret names cannot save', async () => {
  const view = fixture();
  await view.whenStable();
  const component = view.componentInstance;
  component.setEnv({
    target: { value: 'API_TOKEN=collision' },
  } as unknown as Event);
  await component.save(new Event('submit'));
  expect(component.error()).toContain('already used');
  expect(data.updateRuntime).not.toHaveBeenCalled();
  component.removeSecret(0);
  component.addSecret();
  component.editSecret(0, 'name', {
    target: { value: 'TEMP' },
  } as unknown as Event);
  component.editSecret(0, 'value', {
    target: { value: 'unsaved' },
  } as unknown as Event);
  component.discard();
  await view.whenStable();
  expect(component.envText()).toBe('PUBLIC_MODE=preview');
  expect(component.secrets()).toEqual([
    { name: 'API_TOKEN', value: '', saved: true },
  ]);
  expect(component.removedNames()).toEqual([]);
});
