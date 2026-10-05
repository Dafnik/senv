import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { expect, test } from 'vite-plus/test';
import { AdminUsersPage } from './admin-users.page';

test('normalizes malformed page and size query parameters through route input binding', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [{ path: 'admin', component: AdminUsersPage }],
        withComponentInputBinding(),
      ),
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  TestBed.overrideComponent(AdminUsersPage, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  const harness = await RouterTestingHarness.create();
  const component = await harness.navigateByUrl(
    '/admin?page=0&size=-1',
    AdminUsersPage,
  );
  await harness.fixture.whenStable();
  expect(component.page()).toBe(1);
  expect(component.size()).toBe(20);
  const router = TestBed.inject(Router);
  expect(router.parseUrl(router.url).queryParams).toEqual({
    page: '1',
    size: '20',
  });
});
