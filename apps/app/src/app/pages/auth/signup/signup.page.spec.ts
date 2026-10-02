import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { AccountSignup } from '../../../auth/account-signup';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { SignupPage } from './signup.page';

const details = vi.fn();
const complete = vi.fn();
const refetch = vi.fn();
let sessionState: {
  data: { user: { email: string } } | null;
  error: unknown;
  refetch: typeof refetch;
};

beforeEach(() => {
  vi.resetAllMocks();
  details.mockResolvedValue({
    name: 'Invited user',
    email: 'invited@example.com',
  });
  complete.mockResolvedValue({ status: true });
  sessionState = { data: null, error: null, refetch };
  refetch.mockImplementation(async () => {
    sessionState.data = { user: { email: 'invited@example.com' } };
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: QueryClient, useValue: { clear: vi.fn() } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap({ token: 'signup-token' }),
          },
        },
      },
      { provide: AccountSignup, useValue: { details, complete } },
      {
        provide: AUTH_CLIENT,
        useValue: { useSession: () => () => sessionState },
      },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
});

async function signupForm() {
  const fixture = TestBed.createComponent(SignupPage);
  await fixture.whenStable();
  return fixture;
}

async function fillPassword(
  fixture: Awaited<ReturnType<typeof signupForm>>,
  password: string,
  confirmation = password,
) {
  for (const [id, value] of [
    ['signup-password', password],
    ['signup-confirm-password', confirmation],
  ]) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      `#${id}`,
    );
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await fixture.whenStable();
}

test('shows the invited email and requires matching passwords before signup', async () => {
  const fixture = await signupForm();
  expect(details).toHaveBeenCalledExactlyOnceWith('signup-token');
  expect(fixture.nativeElement.textContent).toContain('invited@example.com');
  await fillPassword(fixture, 'my-own-password', 'different-password');
  expect(
    fixture.nativeElement.querySelector('button[type="submit"]').disabled,
  ).toBe(true);
  expect(complete).not.toHaveBeenCalled();
});

test('completes signup and refreshes the login session before navigating', async () => {
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = await signupForm();
  await fillPassword(fixture, 'my-own-password');
  fixture.nativeElement.querySelector('button[type="submit"]').click();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(complete).toHaveBeenCalledExactlyOnceWith({
    token: 'signup-token',
    password: 'my-own-password',
  });
  expect(refetch).toHaveBeenCalledOnce();
  expect(refetch.mock.invocationCallOrder[0]).toBeLessThan(
    navigate.mock.invocationCallOrder[0],
  );
  expect(navigate).toHaveBeenCalledWith('/projects', { replaceUrl: true });
});

test('invalid links show recovery instructions without a password form', async () => {
  details.mockRejectedValueOnce(
    new HttpErrorResponse({
      status: 400,
      error: { message: 'Ask your admin to send a new signup email.' },
    }),
  );
  const fixture = await signupForm();
  expect(fixture.nativeElement.textContent).toContain(
    'Ask your admin to send a new signup email.',
  );
  expect(fixture.nativeElement.querySelector('form')).toBeNull();
  expect(complete).not.toHaveBeenCalled();
});

test('delivery of a signup error leaves the form available to retry', async () => {
  complete.mockRejectedValueOnce(
    new HttpErrorResponse({
      status: 500,
      error: { message: 'Please try again.' },
    }),
  );
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = await signupForm();
  await fillPassword(fixture, 'my-own-password');
  fixture.nativeElement.querySelector('button[type="submit"]').click();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.errorMessage()).toBe('Please try again.'),
  );
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('button[type="submit"]').disabled,
  ).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(refetch).not.toHaveBeenCalled();
});

test('offers login when signup succeeds but refreshing the session fails', async () => {
  refetch.mockImplementationOnce(async () => {
    sessionState.error = { message: 'Offline' };
  });
  const fixture = await signupForm();
  await fillPassword(fixture, 'my-own-password');
  fixture.nativeElement.querySelector('button[type="submit"]').click();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.errorMessage()).toContain(
      'Your account is ready.',
    ),
  );
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('button[type="submit"]'),
  ).toBeNull();
  expect(fixture.nativeElement.textContent).toContain('Continue to login');
});
