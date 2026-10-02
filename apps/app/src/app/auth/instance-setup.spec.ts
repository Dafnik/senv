import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { instanceReadyGuard, setupAvailableGuard } from './instance-setup';

let http: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
});
afterEach(() => http.verify());

test.each([true, false])(
  'normal routes require setup only when needsSetup is %s',
  async (needsSetup) => {
    const result = TestBed.runInInjectionContext(() =>
      instanceReadyGuard({} as never, {} as never),
    );
    http
      .expectOne((r) => r.url.endsWith('/api/auth/instance/setup-status'))
      .flush({ needsSetup });
    const resolved = await result;
    expect(
      resolved instanceof UrlTree
        ? TestBed.inject(Router).serializeUrl(resolved)
        : resolved,
    ).toBe(needsSetup ? '/setup' : true);
  },
);

test.each([true, false])(
  'setup is reachable only when needsSetup is %s',
  async (needsSetup) => {
    const result = TestBed.runInInjectionContext(() =>
      setupAvailableGuard({} as never, {} as never),
    );
    http
      .expectOne((r) => r.url.endsWith('/api/auth/instance/setup-status'))
      .flush({ needsSetup });
    const resolved = await result;
    expect(
      resolved instanceof UrlTree
        ? TestBed.inject(Router).serializeUrl(resolved)
        : resolved,
    ).toBe(needsSetup ? true : '/login');
  },
);
