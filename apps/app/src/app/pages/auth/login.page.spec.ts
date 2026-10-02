import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { LoginPage } from './login.page';

const signIn = vi.fn();
const refetch = vi.fn();
beforeEach(() => {
  signIn.mockReset();
  refetch.mockReset();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: QueryClient, useValue: { clear: vi.fn() } },
      {
        provide: AUTH_CLIENT,
        useValue: {
          signIn: { email: signIn },
          useSession: () => () => ({
            data: { user: { id: 'signed-in' } },
            refetch,
          }),
        },
      },
    ],
  });
});
async function loginForm() {
  const fixture = TestBed.createComponent(LoginPage);
  fixture.componentRef.setInput('redirect', '/invitations/invite-id');
  await fixture.whenStable();
  for (const [id, value] of [
    ['email', 'user@example.com'],
    ['password', 'my-valid-password'],
  ]) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      `#${id}`,
    );
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await fixture.whenStable();
  return fixture;
}
test('network rejection shows an error, resets loading and permits retry without losing the invitation', async () => {
  signIn
    .mockRejectedValueOnce(new Error('Cannot reach the server'))
    .mockResolvedValueOnce({
      data: { user: { id: 'signed-in' } },
      error: null,
    });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = await loginForm();
  await fixture.componentInstance.login(new Event('submit'));
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('[role="alert"]').textContent,
  ).toContain('Cannot reach the server');
  expect(fixture.componentInstance.loading()).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  await fixture.componentInstance.login(new Event('submit'));
  expect(refetch).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith('/invitations/invite-id', {
    replaceUrl: true,
  });
});
test('pending sign-in disables the submit button and prevents another request', async () => {
  let reject!: (error: Error) => void;
  signIn.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  const fixture = await loginForm();
  const pending = fixture.componentInstance.login(new Event('submit'));
  await vi.waitFor(() =>
    expect(fixture.componentInstance.loading()).toBe(true),
  );
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('button[type="submit"]').disabled,
  ).toBe(true);
  await fixture.componentInstance.login(new Event('submit'));
  expect(signIn).toHaveBeenCalledOnce();
  reject(new Error('Offline'));
  await pending;
  expect(fixture.componentInstance.loading()).toBe(false);
});
