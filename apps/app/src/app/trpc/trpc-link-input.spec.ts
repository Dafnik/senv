import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { createTRPCUntypedClient } from '@trpc/client';
import superjson from 'superjson';
import { expect, test } from 'vite-plus/test';
import { angularHttpLink } from './trpc-link-angular';
import { client, request, setupTrpcLinkTests } from './trpc-link.test-support';

setupTrpcLinkTests();
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

test('sends query input in the body when method override is POST', async () => {
  const postClient = createTRPCUntypedClient({
    links: [
      angularHttpLink({
        url: '/api/trpc',
        httpClient: TestBed.inject(HttpClient),
        transformer: superjson,
        methodOverride: 'POST',
      }),
    ],
  });
  const result = postClient.query('echo', 0);
  const pending = await request();
  const url = new URL(pending.request.urlWithParams, 'http://localhost');

  expect(pending.request.method).toBe('POST');
  expect(url.searchParams.has('input')).toBe(false);
  expect(superjson.deserialize(JSON.parse(pending.request.body))).toBe(0);
  pending.flush({ result: { data: superjson.serialize(0) } });
  await expect(result).resolves.toBe(0);
});
