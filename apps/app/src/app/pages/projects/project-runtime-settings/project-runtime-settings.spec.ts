import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
async function enterText(
  view: ComponentFixture<ProjectRuntimeSettings>,
  selector: string,
  value: string,
) {
  const control = view.nativeElement.querySelector(
    selector,
  ) as HTMLInputElement;
  control.value = value;
  control.dispatchEvent(new Event('input'));
  await view.whenStable();
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
  await enterText(view, '#project-runtime-env', 'PUBLIC_MODE=next');
  await component.save(new Event('submit'));
  await view.whenStable();
  expect(data.updateRuntime).toHaveBeenCalledWith('runtime-project', {
    env: { PUBLIC_MODE: 'next' },
    secrets: {},
    removeSecretNames: [],
  });
  await enterText(view, '#project-secret-value-0', 'new-private-value');
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
  await enterText(view, '#project-runtime-env', 'API_TOKEN=collision');
  await component.save(new Event('submit'));
  expect(component.runtimeForm().errors()[0]?.message).toContain(
    'already used',
  );
  expect(data.updateRuntime).not.toHaveBeenCalled();
  component.removeSecret(0);
  component.addSecret();
  await view.whenStable();
  await enterText(view, '#project-secret-name-0', 'TEMP');
  await enterText(view, '#project-secret-value-0', 'unsaved');
  component.discard();
  await view.whenStable();
  expect(component.envText()).toBe('PUBLIC_MODE=preview');
  expect(component.secrets()).toMatchObject([
    { name: 'API_TOKEN', value: '', saved: true },
  ]);
  expect(component.removedNames()).toEqual([]);
});

test('viewers can read saved variables and secret names without editing controls', async () => {
  const view = fixture();
  view.componentRef.setInput('canManage', false);
  await view.whenStable();
  expect(data.runtime).toHaveBeenCalledWith(
    'runtime-session',
    'runtime-project',
  );
  expect(view.nativeElement.textContent).toContain('PUBLIC_MODE=preview');
  expect(view.nativeElement.textContent).toContain('API_TOKEN');
  expect(view.nativeElement.querySelector('form')).toBeNull();
  expect(view.nativeElement.querySelector('input[type="password"]')).toBeNull();
  await view.componentInstance.save(new Event('submit'));
  expect(data.updateRuntime).not.toHaveBeenCalled();
});

test('signal form prevents malformed and oversized runtime values from being submitted', async () => {
  const view = fixture();
  await view.whenStable();
  for (const value of [
    'INVALID-NAME=value',
    'MODE=first\nMODE=second',
    `MODE=${'x'.repeat(16385)}`,
  ]) {
    await enterText(view, '#project-runtime-env', value);
    await view.componentInstance.save(new Event('submit'));
    await view.whenStable();
    expect(view.componentInstance.runtimeForm().invalid()).toBe(true);
    expect(view.nativeElement.querySelector('hlm-field-error')).not.toBeNull();
    expect(data.updateRuntime).not.toHaveBeenCalled();
  }
});
