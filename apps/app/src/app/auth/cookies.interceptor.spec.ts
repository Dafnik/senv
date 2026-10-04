import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { REQUEST } from '@angular/core';
import { afterEach, expect, test } from 'vite-plus/test';
import { environment } from '../../environments/environment';
import { cookiesInterceptor, isOwnApiRequest } from './cookies.interceptor';

afterEach(() => TestBed.resetTestingModule());

test('cookie forwarding only matches the configured API origin and path boundary', () => {
  const api = 'https://api.example.test';
  expect(isOwnApiRequest('https://api.example.test/users', api)).toBe(true);
  expect(isOwnApiRequest('https://api.example.test.evil.test/users', api)).toBe(
    false,
  );
  expect(isOwnApiRequest('https://app.example.test/users', api)).toBe(false);
  expect(
    isOwnApiRequest('https://api.example.test/api/auth/session', api),
  ).toBe(false);
  expect(isOwnApiRequest('https://api.example.test/api/authentic', api)).toBe(
    true,
  );
  expect(
    isOwnApiRequest('https://api.example.test/base/users', `${api}/base`),
  ).toBe(true);
  expect(
    isOwnApiRequest('https://api.example.test/baseball/users', `${api}/base`),
  ).toBe(false);
  expect(isOwnApiRequest('http://[', api)).toBe(false);
  expect(isOwnApiRequest('/users', environment.baseUrl)).toBe(true);
});

test('SSR forwards cookies only to the configured API origin', () => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([cookiesInterceptor])),
      provideHttpClientTesting(),
      {
        provide: REQUEST,
        useValue: new Request('https://app.example.test', {
          headers: { cookie: 'session=secret' },
        }),
      },
    ],
  });
  const http = TestBed.inject(HttpClient);
  const requests = TestBed.inject(HttpTestingController);
  http.get(`${environment.apiUrl}/users`).subscribe();
  const own = requests.expectOne(`${environment.apiUrl}/users`);
  expect(own.request.withCredentials).toBe(true);
  expect(own.request.headers.get('Cookie')).toBe('session=secret');
  own.flush({});

  const lookalike = 'https://api.senv.marcjulian.de.evil.test/users';
  http.get(lookalike).subscribe();
  const external = requests.expectOne(lookalike);
  expect(external.request.withCredentials).toBe(false);
  expect(external.request.headers.has('Cookie')).toBe(false);
  external.flush({});
  requests.verify();
});
