import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { ProjectMembers } from './project-members';

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());

const members = Array.from({ length: 25 }, (_, index) => ({
  id: `member-${index}`,
  userId: `user-${index}`,
  role: index ? 'viewer' : 'admin',
  invitedByName: index ? 'Inviting Admin' : null,
  user: {
    name: `Member ${String(index).padStart(2, '0')}`,
    email: `member-${index}@example.com`,
  },
}));

function createTable(canManage = false) {
  const fixture = TestBed.createComponent(ProjectMembers);
  fixture.componentRef.setInput('members', members);
  fixture.componentRef.setInput('currentUserId', 'user-0');
  fixture.componentRef.setInput('canManage', canManage);
  return fixture;
}

test('members sort across pages and email filtering returns to the first page', async () => {
  const fixture = createTable();
  await fixture.whenStable();
  const table = fixture.componentInstance.table;
  expect(table.getPageCount()).toBe(2);
  expect(table.getRowModel().rows).toHaveLength(20);
  table.setSorting([{ id: 'name', desc: true }]);
  await fixture.whenStable();
  expect(table.getRowModel().rows[0].original.id).toBe('member-24');
  table.nextPage();
  await fixture.whenStable();
  expect(table.getRowModel().rows).toHaveLength(5);
  fixture.componentInstance.search.set('MEMBER-0@EXAMPLE.COM');
  await fixture.whenStable();
  expect(fixture.componentInstance.pagination().pageIndex).toBe(0);
  expect(table.getRowModel().rows.map((row) => row.id)).toEqual(['member-0']);
  expect(fixture.nativeElement.textContent).toContain('(you)');
});

test('admins can change a member role and controls are disabled during an update', async () => {
  const fixture = createTable(true);
  const changed = vi.fn();
  fixture.componentInstance.roleChanged.subscribe(changed);
  await fixture.whenStable();
  const trigger: HTMLButtonElement = fixture.nativeElement.querySelector(
    'button[aria-label="Member actions for Member 00"]',
  );
  trigger.click();
  await fixture.whenStable();
  const roleTrigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Change role for Member 00"]',
  )!;
  expect(roleTrigger.textContent).toContain('Role: Admin');
  roleTrigger.click();
  await fixture.whenStable();
  expect(
    document.querySelector('button[hlmDropdownMenuRadio][aria-checked="true"]')
      ?.textContent,
  ).toContain('Admin');
  const developer = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[hlmDropdownMenuRadio]'),
  ).find((button) => button.textContent?.trim() === 'Developer');
  expect(developer).toBeDefined();
  developer!.click();
  await fixture.whenStable();
  expect(changed).toHaveBeenCalledWith({
    memberId: 'member-0',
    role: 'developer',
  });
  fixture.componentRef.setInput('busy', true);
  await fixture.whenStable();
  expect(trigger.disabled).toBe(true);
});

test('member removal requires confirmation and members can see who invited them', async () => {
  const fixture = createTable(true);
  const removed = vi.fn();
  fixture.componentInstance.removed.subscribe(removed);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('Invited by');
  expect(fixture.nativeElement.textContent).toContain('Inviting Admin');
  fixture.nativeElement
    .querySelector('button[aria-label="Member actions for Member 01"]')
    .click();
  await fixture.whenStable();
  expect(removed).not.toHaveBeenCalled();
  const remove = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[hlmDropdownMenuItem]'),
  ).find((button) => button.textContent?.trim() === 'Remove member');
  expect(remove).toBeDefined();
  remove!.click();
  await fixture.whenStable();
  expect(removed).not.toHaveBeenCalled();
  const confirm = document.querySelector<HTMLButtonElement>(
    'button[hlmAlertDialogAction]',
  )!;
  expect(confirm).not.toBeNull();
  confirm.click();
  await fixture.whenStable();
  expect(removed).toHaveBeenCalledWith('member-1');
});

test('ordinary members have no removal controls', async () => {
  const fixture = createTable(false);
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('button[hlmDropdownMenuTrigger]'),
  ).toBeNull();
});
