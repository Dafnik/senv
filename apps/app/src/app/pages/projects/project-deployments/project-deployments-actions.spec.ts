import { expect, test } from 'vite-plus/test';
import { TestBed } from '@angular/core/testing';
import { DeploymentList } from '../deployment-list';
import {
  createFixture,
  display,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { deployments, session } from './project-deployments.spec-data';
import { mock } from './project-deployments.spec-mocks';
setupProjectDeploymentTests();

test('switching sessions closes publishing and clears tags and details', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.publishOpen.set(true);
  display(fixture).tagDrafts.set({ 'deployment-a': 'prod' });

  session.set({
    data: {
      session: { id: 'session-b' },
      user: { id: 'another-user', role: 'user' },
    },
  });
  fixture.detectChanges();
  await fixture.whenStable();

  expect(component.publishOpen()).toBe(false);
  expect(display(fixture).tagDrafts()).toEqual({});
});

test('tag forms reject unsafe names and allow healthy deployments to assign a valid tag', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  const component = display(fixture);
  component.tagDrafts.set({ 'deployment-a': 'br-release' });
  await component.assignTag(new Event('submit'), deployments[0] as never);
  expect(mock.assignTag).not.toHaveBeenCalled();

  component.tagDrafts.set({ 'deployment-a': 'preview-canary' });
  await component.assignTag(new Event('submit'), deployments[0] as never);
  await fixture.whenStable();
  expect(mock.assignTag).toHaveBeenCalledWith(
    'project-a',
    'preview-canary',
    'deployment-a',
  );
});

test('pinning a deployment uses the project mutation and refreshes the list', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  await display(fixture).setPinned(deployments[0]!);
  expect(mock.setPinned).toHaveBeenCalledWith(
    'project-a',
    'deployment-a',
    true,
  );
  expect(mock.invalidate).toHaveBeenCalledWith('session-a', 'project-a');
});

test('pin controls show the action and an icon in both states', async () => {
  const fixture = TestBed.createComponent(DeploymentList);
  fixture.componentRef.setInput('projectId', 'project-a');
  fixture.componentRef.setInput('canManage', true);
  fixture.componentRef.setInput('items', [
    { ...deployments[0]!, pinned: true },
  ]);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const unpin = element.querySelector(
    'button[aria-label="Unpin deployment deployment-a"]',
  )!;
  expect(unpin.textContent?.trim()).toBe('Unpin');
  expect(unpin.querySelector('ng-icon svg')).not.toBeNull();
  const unpinIcon = unpin.querySelector('ng-icon')!.innerHTML;
  fixture.componentRef.setInput('items', [
    { ...deployments[0]!, pinned: false },
  ]);
  await fixture.whenStable();
  const pin = element.querySelector(
    'button[aria-label="Pin deployment deployment-a"]',
  )!;
  expect(pin.textContent?.trim()).toBe('Pin');
  expect(pin.querySelector('ng-icon svg')).not.toBeNull();
  expect(pin.querySelector('ng-icon')!.innerHTML).not.toBe(unpinIcon);
});

test('tag management opens below the action toolbar', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const trigger = Array.from(
    element.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.includes('Manage tags'))!;
  trigger.click();
  await fixture.whenStable();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const panel = element.querySelector('#deployment-tags-deployment-a')!;
  expect(panel.parentElement).toBe(trigger.closest('footer'));
  expect(panel.contains(trigger)).toBe(false);
  expect(panel.querySelector('input')).not.toBeNull();
  expect(element.querySelector('header app-deployment-pin')).not.toBeNull();
  expect(element.querySelector('footer app-deployment-pin')).toBeNull();
});

test('a failed tag assignment preserves the draft', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  mock.assignTag.mockRejectedValueOnce(new Error('Could not assign tag'));
  const actions = display(fixture);
  actions.tagDrafts.set({ 'deployment-a': 'stable' });
  await actions.assignTag(new Event('submit'), deployments[0]!);
  expect(actions.tagDrafts()['deployment-a']).toBe('stable');
});
