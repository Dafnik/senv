import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { expect, test } from 'vite-plus/test';
import { AUTH_CLIENT } from './auth-client';
import { authGuard } from './auth-guard';

test.each([null, undefined, 'user', 'admin,user'])(
  'admin guard rejects instance role %s',
  async (role) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AUTH_CLIENT,
          useValue: {
            useSession: () =>
              of({ isPending: false, data: { user: { id: 'user', role } } }),
          },
        },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      authGuard('admin')({} as never, { url: '/admin/users' } as never),
    );
    const resolved = isObservable(result)
      ? await firstValueFrom(result)
      : await result;
    expect(TestBed.inject(Router).serializeUrl(resolved as UrlTree)).toBe(
      '/forbidden',
    );
  },
);
test('initial session failure retains the intended destination on the retry route', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: () =>
            of({
              isPending: false,
              error: { message: 'Offline' },
              data: { user: { id: 'old', role: 'admin' } },
            }),
        },
      },
    ],
  });
  const result = TestBed.runInInjectionContext(() =>
    authGuard()({} as never, { url: '/projects/project-id/settings' } as never),
  );
  const resolved = isObservable(result)
    ? await firstValueFrom(result)
    : await result;
  expect(TestBed.inject(Router).serializeUrl(resolved as UrlTree)).toBe(
    '/unavailable?redirect=%2Fprojects%2Fproject-id%2Fsettings',
  );
});
