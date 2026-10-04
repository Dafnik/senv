import { TestBed } from '@angular/core/testing';
import { expect, test, vi } from 'vite-plus/test';
import {
  acceptInvitation,
  getInvitation,
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
