import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { createTRPCUntypedClient } from '@trpc/client';
import superjson from 'superjson';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { angularHttpLink } from './trpc-link-angular';

let http: HttpTestingController;
let client: ReturnType<typeof createTRPCUntypedClient>;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  http = TestBed.inject(HttpTestingController);
  client = createTRPCUntypedClient({
    links: [
      angularHttpLink({
        url: '/api/trpc',
        httpClient: TestBed.inject(HttpClient),
        transformer: superjson,
      }),
    ],
  });
});

afterEach(() => {
  http.verify({ ignoreCancelled: true });
});

async function request() {
  let pending!: TestRequest;
  await vi.waitFor(() => {
    pending = http.expectOne((req) => req.url.startsWith('/api/trpc/echo'));
  });
  return pending;
}

test.each([false, 0, '', null])(
  'preserves scalar mutation input %j',
  async (input) => {
    const result = client.mutation('echo', input);
    const pending = await request();
    expect(superjson.deserialize(JSON.parse(pending.request.body))).toEqual(
      input,
    );
    pending.flush({ result: { data: superjson.serialize(input) } });
    await expect(result).resolves.toEqual(input);
  },
);

test.each([false, 0, '', null])(
  'preserves scalar query input %j',
  async (input) => {
    const result = client.query('echo', input);
    const pending = await request();
    const url = new URL(pending.request.urlWithParams, 'http://localhost');
    expect(
      superjson.deserialize(JSON.parse(url.searchParams.get('input')!)),
    ).toEqual(input);
    pending.flush({ result: { data: superjson.serialize(input) } });
    await expect(result).resolves.toEqual(input);
  },
);

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
