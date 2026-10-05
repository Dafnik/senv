import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { ProjectsData } from '../../../queries/projects';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { InviteForm } from './invite-form';

const inviteMember = vi.fn();
const invalidateInvitations = vi.fn();
const session = signal({ data: { session: { id: 'session-id' } } });

beforeEach(() => {
  vi.resetAllMocks();
  invalidateInvitations.mockReset().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ProjectsData,
        useValue: { invite: inviteMember, invalidateInvitations },
      },
      { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
    ],
  });
});

async function createForm() {
  const fixture = TestBed.createComponent(InviteForm);
  fixture.componentRef.setInput('projectId', 'project-id');
  await fixture.whenStable();
  return fixture;
}

async function enterEmail(
  fixture: Awaited<ReturnType<typeof createForm>>,
  email: string,
) {
  const input: HTMLInputElement =
    fixture.nativeElement.querySelector('#invite-email');
  input.value = email;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur'));
  await fixture.whenStable();
}

test('invitation starts collapsed and cancelling resets email, role, and validation', async () => {
  const fixture = await createForm();
  expect(fixture.nativeElement.querySelector('form')).toBeNull();
  fixture.nativeElement.querySelector('button').click();
  await fixture.whenStable();
  await enterEmail(fixture, 'invalid-email');
  fixture.componentInstance.selectRole('admin');
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain(
    'Enter a valid email address.',
  );
  expect(
    fixture.nativeElement.querySelector('button[type="submit"]').disabled,
  ).toBe(true);
  const cancel = Array.from(
    fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>,
  ).find((button) => button.textContent?.trim() === 'Cancel');
  cancel!.click();
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('form')).toBeNull();
  fixture.nativeElement.querySelector('button').click();
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('#invite-email').value).toBe('');
  expect(fixture.componentInstance.inviteForm.role().value()).toBe('viewer');
  expect(fixture.componentInstance.inviteForm.email().touched()).toBe(false);
  expect(inviteMember).not.toHaveBeenCalled();
});

test('failed invitations retain the form for retry and success emits refresh, resets, and closes it', async () => {
  inviteMember
    .mockRejectedValueOnce(new Error('Could not send email'))
    .mockResolvedValueOnce({ id: 'invitation-id' });
  const fixture = await createForm();
  const sent = vi.fn();
  fixture.componentInstance.sent.subscribe(sent);
  fixture.nativeElement.querySelector('button').click();
  await fixture.whenStable();
  await enterEmail(fixture, 'recipient@example.com');
  fixture.componentInstance.selectRole('developer');
  fixture.nativeElement.querySelector('button[type="submit"]').click();
  await vi.waitFor(() => expect(inviteMember).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
  await fixture.whenStable();
  expect(fixture.componentInstance.open()).toBe(true);
  expect(fixture.nativeElement.querySelector('#invite-email').value).toBe(
    'recipient@example.com',
  );
  expect(fixture.componentInstance.inviteForm.role().value()).toBe('developer');
  expect(sent).not.toHaveBeenCalled();
  fixture.nativeElement.querySelector('button[type="submit"]').click();
  await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(invalidateInvitations).toHaveBeenCalledWith(
    'session-id',
    'project-id',
  );
  await fixture.whenStable();
  expect(inviteMember).toHaveBeenLastCalledWith(
    'project-id',
    'recipient@example.com',
    'developer',
  );
  expect(fixture.componentInstance.open()).toBe(false);
  expect(fixture.nativeElement.querySelector('form')).toBeNull();
  expect(fixture.componentInstance.inviteForm.email().value()).toBe('');
  expect(fixture.componentInstance.inviteForm.role().value()).toBe('viewer');
});

test('locks all invitation controls while the request is pending', async () => {
  let finish!: () => void;
  inviteMember.mockReturnValue(
    new Promise<void>((resolve) => (finish = resolve)),
  );
  const fixture = await createForm();
  fixture.nativeElement.querySelector('button').click();
  await fixture.whenStable();
  await enterEmail(fixture, 'recipient@example.com');
  fixture.nativeElement.querySelector('button[type="submit"]').click();
  await vi.waitFor(() => expect(inviteMember).toHaveBeenCalledOnce());
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('#invite-email').disabled).toBe(
    true,
  );
  expect(
    Array.from(
      fixture.nativeElement.querySelectorAll(
        'button',
      ) as NodeListOf<HTMLButtonElement>,
    ).some(
      (button) => button.textContent?.trim() === 'Admin' && button.disabled,
    ),
  ).toBe(true);
  finish();
  await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
});
