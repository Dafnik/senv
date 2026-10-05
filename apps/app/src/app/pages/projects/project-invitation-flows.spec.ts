import { TestBed } from '@angular/core/testing';
import { expect, test, vi } from 'vite-plus/test';
import {
  acceptInvitation,
  getInvitation,
  getFullOrganization,
  list,
  project,
  queryClient,
  sendVerificationEmail,
  session,
  setupProjectTests,
} from './projects.spec-setup';
import { InvitationPage } from './invitation-page/invitation-page.page';
import { ProjectsPage } from './projects-page/projects-page.page';

setupProjectTests();
test('returning to Projects immediately after acceptance shows the joined project', async () => {
  queryClient.setQueryData(['projects', 'session-id'], {
    pages: [{ projects: [], nextCursor: null }],
    pageParams: [undefined],
  });
  getInvitation.mockResolvedValue({
    organizationName: project.name,
    role: 'viewer',
    expiresAt: new Date().toISOString(),
  });
  acceptInvitation.mockResolvedValue({
    data: { member: { organizationId: project.id } },
    error: null,
  });
  list.mockResolvedValue({ projects: [project], nextCursor: null });
  const invite = TestBed.createComponent(InvitationPage);
  invite.componentRef.setInput('invitationId', 'invite-id');
  await invite.whenStable();
  await invite.componentInstance.accept();
  invite.destroy();
  const projects = TestBed.createComponent(ProjectsPage);
  await vi.waitFor(async () => {
    await projects.whenStable();
    expect(projects.nativeElement.textContent).toContain('Old name');
  });
  expect(list).toHaveBeenCalledTimes(1);
});

test('unverified users can request verification and return to the invitation after confirming their email', async () => {
  session.update((s) => ({
    data: { ...s.data, user: { ...s.data.user, emailVerified: false } },
  }));
  sendVerificationEmail.mockResolvedValue({
    data: { status: true },
    error: null,
  });
  const invite = TestBed.createComponent(InvitationPage);
  invite.componentRef.setInput('invitationId', 'invite-id');
  await invite.whenStable();
  expect(getInvitation).not.toHaveBeenCalled();
  expect(invite.nativeElement.textContent).toContain('Send verification email');
  expect(invite.nativeElement.textContent).not.toContain('Accept invitation');
  await invite.componentInstance.sendVerification();
  expect(sendVerificationEmail).toHaveBeenCalledWith({
    email: 'admin@example.com',
    callbackURL: expect.stringMatching(
      /^https?:\/\/[^/]+\/invitations\/invite-id$/,
    ),
  });
  getInvitation.mockResolvedValue({
    organizationName: project.name,
    role: 'viewer',
    expiresAt: new Date().toISOString(),
  });
  session.update((s) => ({
    data: { ...s.data, user: { ...s.data.user, emailVerified: true } },
  }));
  await vi.waitFor(async () => {
    await invite.whenStable();
    expect(invite.nativeElement.textContent).toContain('Accept invitation');
  });
  expect(getInvitation).toHaveBeenCalledTimes(1);
});

test('keeps acceptance confirmed when loading project details fails afterward', async () => {
  getInvitation.mockResolvedValue({
    organizationName: project.name,
    role: 'viewer',
    expiresAt: new Date().toISOString(),
  });
  acceptInvitation.mockResolvedValue({
    data: { member: { organizationId: project.id } },
    error: null,
  });
  getFullOrganization.mockRejectedValue(new Error('Project service offline'));
  const fixture = TestBed.createComponent(InvitationPage);
  fixture.componentRef.setInput('invitationId', 'invite-id');
  await fixture.whenStable();
  await fixture.componentInstance.accept();
  fixture.detectChanges();
  expect(fixture.componentInstance.accepted()).toBe(true);
  expect(fixture.nativeElement.textContent).toContain(
    'You accepted this invitation.',
  );
  expect(fixture.nativeElement.textContent).not.toContain(
    'Project service offline',
  );
});

test('a rejected accept for an old link does not refresh or report against the new link', async () => {
  let reject!: (error: Error) => void;
  acceptInvitation.mockReturnValue(new Promise((_, fail) => (reject = fail)));
  getInvitation.mockResolvedValue({
    organizationName: project.name,
    role: 'viewer',
    expiresAt: new Date().toISOString(),
  });
  const fixture = TestBed.createComponent(InvitationPage);
  fixture.componentRef.setInput('invitationId', 'old-invite');
  await fixture.whenStable();
  const refetch = vi.spyOn(fixture.componentInstance.invitation, 'refetch');
  const accepting = fixture.componentInstance.accept();
  session.update((current) => ({
    data: {
      ...current.data,
      session: { ...current.data.session, id: 'new-session' },
    },
  }));
  fixture.componentRef.setInput('invitationId', 'new-invite');
  await fixture.whenStable();
  reject(new Error('old request failed'));
  await accepting;
  fixture.detectChanges();
  expect(refetch).not.toHaveBeenCalled();
  expect(fixture.componentInstance.accepted()).toBe(false);
  expect(fixture.nativeElement.textContent).not.toContain('old request failed');
});

test('transient invitation lookup errors show a retry action instead of expired-link guidance', async () => {
  getInvitation
    .mockRejectedValueOnce(new Error('Invitation service offline'))
    .mockResolvedValueOnce({
      organizationName: project.name,
      role: 'viewer',
      expiresAt: new Date().toISOString(),
    });
  const fixture = TestBed.createComponent(InvitationPage);
  fixture.componentRef.setInput('invitationId', 'invite-id');
  await vi.waitFor(() =>
    expect(fixture.componentInstance.invitation.isError()).toBe(true),
  );
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('try again');
  expect(fixture.nativeElement.textContent).not.toContain(
    'link may have expired',
  );
  const retry = Array.from(
    fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>,
  ).find((button) => button.textContent?.trim() === 'Try again');
  retry!.click();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.invitation.isSuccess()).toBe(true),
  );
  expect(fixture.nativeElement.textContent).toContain('Join Old name');
});
