import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { createTRPCUntypedClient } from '@trpc/client';
import superjson from 'superjson';
import { afterEach, beforeEach, vi } from 'vite-plus/test';
import { angularHttpLink } from './trpc-link-angular';

export let http: HttpTestingController;
export let client: ReturnType<typeof createTRPCUntypedClient>;

export function setupTrpcLinkTests() {
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
}

export async function request() {
  let pending!: TestRequest;
  await vi.waitFor(() => {
    pending = http.expectOne((req) => req.url.startsWith('/api/trpc/echo'));
  });
  return pending;
}
