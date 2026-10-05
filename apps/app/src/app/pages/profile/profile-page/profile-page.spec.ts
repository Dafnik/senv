import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { ProfilePage } from './profile-page.page';
import { AccessManagement } from '../access-management/access-management';

@Component({ selector: 'app-access-management', template: '' })
class AccessManagementStub {}

let http: HttpTestingController;
beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClientTesting(),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: () => () => ({
            data: {
              user: {
                id: 'signed-in-user',
                name: 'Jane Doe',
                email: 'jane@example.com',
                role: 'admin',
              },
              session: { id: 'signed-in-session' },
            },
          }),
        },
      },
    ],
  });
  TestBed.overrideComponent(ProfilePage, {
    remove: { imports: [AccessManagement] },
    add: { imports: [AccessManagementStub] },
  });
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => http.verify());

test('profile shows account details and requests a verification email for the signed-in account', async () => {
  const fixture = TestBed.createComponent(ProfilePage);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('Jane Doe');
  const instanceRole = Array.from(
    fixture.nativeElement.querySelectorAll(
      'dl > div',
    ) as NodeListOf<HTMLElement>,
  ).find((item) => item.querySelector('dt')?.textContent === 'Instance role');
  expect(instanceRole?.querySelector('dd')?.textContent).toBe('Admin');
  expect(fixture.nativeElement.textContent).toContain('jane@example.com');
  const button: HTMLButtonElement =
    fixture.nativeElement.querySelector('button');
  button.click();
  const request = http.expectOne((request) =>
    request.url.endsWith('/account-password/self-reset'),
  );
  expect(request.request.method).toBe('POST');
  expect(request.request.withCredentials).toBe(true);
  expect(request.request.body).toEqual({});
  await fixture.whenStable();
  expect(button.disabled).toBe(true);
  expect(fixture.nativeElement.querySelector('p[role="status"]')).toBeNull();
  request.flush({ status: true });
  await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
  await fixture.whenStable();
  expect(button.disabled).toBe(false);
  expect(
    fixture.nativeElement.querySelector('p[role="status"]').textContent,
  ).toContain('Verification email sent');
});

test('failed email delivery displays the error and allows retry', async () => {
  const fixture = TestBed.createComponent(ProfilePage);
  await fixture.whenStable();
  const button: HTMLButtonElement =
    fixture.nativeElement.querySelector('button');
  button.click();
  http
    .expectOne((request) =>
      request.url.endsWith('/account-password/self-reset'),
    )
    .flush(
      { message: 'The reset email could not be sent. Please try again.' },
      { status: 500, statusText: 'Internal Server Error' },
    );
  await fixture.whenStable();
  expect(button.disabled).toBe(false);
  expect(
    fixture.nativeElement.querySelector('[role="alert"]').textContent,
  ).toContain('could not be sent');
  expect(fixture.nativeElement.querySelector('p[role="status"]')).toBeNull();
  button.click();
  http
    .expectOne((request) =>
      request.url.endsWith('/account-password/self-reset'),
    )
    .flush({ status: true });
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  expect(
    fixture.nativeElement.querySelector('p[role="status"]'),
  ).not.toBeNull();
});
