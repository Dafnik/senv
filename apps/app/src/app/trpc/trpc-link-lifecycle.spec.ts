import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { createTRPCUntypedClient } from '@trpc/client';
import superjson from 'superjson';
import { expect, test, vi } from 'vite-plus/test';
import { angularHttpLink } from './trpc-link-angular';
import {
  client,
  http,
  request,
  setupTrpcLinkTests,
} from './trpc-link.test-support';

setupTrpcLinkTests();
test('cancellation rejects the request and unsubscribes HTTP without throwing', async () => {
  const controller = new AbortController();
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
  const result = client.query('echo', undefined, { signal: controller.signal });
  const pending = await request();
  const rejected = expect(result).rejects.toMatchObject({
    cause: { name: 'AbortError' },
  });
  expect(() => controller.abort()).not.toThrow();
  await rejected;
  expect(pending.cancelled).toBe(true);
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('removes the abort listener after a successful response', async () => {
  const controller = new AbortController();
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
  const result = client.query('echo', undefined, { signal: controller.signal });
  (await request()).flush({ result: { data: superjson.serialize('ok') } });
  await expect(result).resolves.toBe('ok');
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(() => controller.abort()).not.toThrow();
});

test('does not send HTTP for an already cancelled operation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.query('echo', undefined, { signal: controller.signal }),
  ).rejects.toMatchObject({ cause: { name: 'AbortError' } });
  http.expectNone((req) => req.url.startsWith('/api/trpc/'));
});

test('preserves structured HTTP error bodies and response metadata', async () => {
  const result = client.query('echo', undefined);
  const pending = await request();
  const responseBody = {
    error: superjson.serialize({
      message: 'Invalid input',
      code: -32600,
      data: { code: 'BAD_REQUEST', httpStatus: 400, path: 'echo' },
    }),
  };

  pending.flush(responseBody, {
    status: 400,
    statusText: 'Bad Request',
    headers: new HttpHeaders({ 'x-request-id': 'request-123' }),
  });

  const error = (await result.catch((cause: unknown) => cause)) as Error & {
    meta?: {
      responseJSON?: unknown;
      response?: {
        status: number;
        statusText: string;
        headers: HttpHeaders;
      };
    };
  };
  expect(error).toMatchObject({
    meta: {
      responseJSON: responseBody,
      response: {
        status: 400,
        statusText: 'Bad Request',
      },
    },
  });
  expect(error.meta?.response?.headers.get('x-request-id')).toBe('request-123');
});

test('resolves asynchronous headers before sending the request', async () => {
  const asyncClient = createTRPCUntypedClient({
    links: [
      angularHttpLink({
        url: '/api/trpc',
        httpClient: TestBed.inject(HttpClient),
        transformer: superjson,
        headers: async () => ({ 'x-session-token': 'session-token' }),
      }),
    ],
  });
  const result = asyncClient.query('echo', 'ready');
  const pending = await request();

  expect(pending.request.headers.get('x-session-token')).toBe('session-token');
  pending.flush({ result: { data: superjson.serialize('ready') } });
  await expect(result).resolves.toBe('ready');
});

test('cancels while asynchronous headers are pending without sending HTTP', async () => {
  let resolveHeaders!: (headers: Record<string, string>) => void;
  const headers = new Promise<Record<string, string>>((resolve) => {
    resolveHeaders = resolve;
  });
  const headersCallback = vi.fn(() => headers);
  const asyncClient = createTRPCUntypedClient({
    links: [
      angularHttpLink({
        url: '/api/trpc',
        httpClient: TestBed.inject(HttpClient),
        transformer: superjson,
        headers: headersCallback,
      }),
    ],
  });
  const controller = new AbortController();
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
  const result = asyncClient.query('echo', 'cancel', {
    signal: controller.signal,
  });

  await vi.waitFor(() => expect(headersCallback).toHaveBeenCalled());
  const rejected = expect(result).rejects.toMatchObject({
    cause: { name: 'AbortError' },
  });
  controller.abort();
  resolveHeaders({});

  await rejected;
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  http.expectNone((req) => req.url.startsWith('/api/trpc/'));
});
