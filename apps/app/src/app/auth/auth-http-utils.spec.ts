import {
  HttpErrorResponse,
  HttpHeaders,
  HttpResponse,
} from '@angular/common/http';
import { expect, test } from 'vite-plus/test';
import { headersFromFetch, processAuthResponse } from './auth-http-utils';

test('auth response adapter preserves falsy JSON payloads', async () => {
  for (const body of [false, 0, '']) {
    const response = processAuthResponse(
      new HttpResponse({ status: 200, body }),
    );
    expect(await response.json()).toBe(body);
  }
});

test('auth response adapter keeps all values from repeated headers', () => {
  const headers = new HttpHeaders()
    .append('x-auth', 'first')
    .append('x-auth', 'second');
  const response = processAuthResponse(
    new HttpResponse({ status: 200, headers }),
  );
  expect(response.headers.get('x-auth')).toBe('first, second');
});

test('repeated Set-Cookie values keep Expires commas from being treated as separators', () => {
  const headers = new HttpHeaders()
    .append(
      'set-cookie',
      'session=first; Expires=Wed, 21 Oct 2030 07:28:00 GMT',
    )
    .append('set-cookie', 'csrf=second; Path=/');
  const response = processAuthResponse(
    new HttpResponse({ status: 200, headers }),
  );
  expect(response.headers.getSetCookie()).toEqual([
    'session=first; Expires=Wed, 21 Oct 2030 07:28:00 GMT',
    'csrf=second; Path=/',
  ]);
});

test('fetch headers accept standard Headers and tuple inputs', () => {
  expect(headersFromFetch(new Headers([['x-test', 'value']]))).toEqual({
    'x-test': 'value',
  });
  expect(headersFromFetch([['x-test', 'tuple']])).toEqual({
    'x-test': 'tuple',
  });
});

test('error response preserves a falsy JSON payload', async () => {
  const responseLike = {
    status: 400,
    statusText: 'Bad Request',
    headers: new HttpHeaders(),
    error: false,
  } as unknown as HttpErrorResponse;
  const response = processAuthResponse(responseLike);
  expect(await response.json()).toBe(false);
});
