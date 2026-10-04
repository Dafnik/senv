import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import type { HttpResponse } from '@angular/common/http';
import type { HTTPHeaders } from '@trpc/client';
import type { CombinedDataTransformer } from '@trpc/server/unstable-core-do-not-import';
import { Observable, Subscription } from 'rxjs';
import { throwIfAborted } from './abort-utils';
import {
  createResponseMeta,
  getInput,
  getUrl,
  type HTTPResult,
} from './http-utils';

const METHOD = {
  query: 'GET',
  mutation: 'POST',
} as const;

/**
 * Angular HttpClient-based HTTP requester that follows tRPC's error handling patterns
 */
export async function angularHttpRequester(
  httpClient: HttpClient,
  opts: {
    url: string;
    type: 'query' | 'mutation';
    path: string;
    input?: unknown;
    signal?: AbortSignal;
    headers: HTTPHeaders;
    transformer: CombinedDataTransformer;
    methodOverride?: 'POST';
  },
): Promise<HTTPResult> {
  throwIfAborted(opts.signal);

  const method = opts.methodOverride ?? METHOD[opts.type];

  // Build the URL with query parameters for GET requests
  const urlWithParams = getUrl({
    ...opts,
    input: opts.input,
    transformer: opts.transformer,
    signal: opts.signal ?? null,
  });

  // Convert headers to Angular HttpHeaders
  let angularHeaders = new HttpHeaders();
  if (opts.headers) {
    const headerObj = opts.headers as Record<string, string | string[]>;
    for (const [key, value] of Object.entries(headerObj)) {
      if (typeof value === 'string') {
        angularHeaders = angularHeaders.set(key, value);
      } else if (Array.isArray(value)) {
        angularHeaders = angularHeaders.set(key, value.join(', '));
      }
    }
  }

  // Set content type for POST requests
  if (method === 'POST') {
    angularHeaders = angularHeaders.set('Content-Type', 'application/json');
  }

  const requestOptions = {
    headers: angularHeaders,
    observe: 'response' as const,
    responseType: 'json' as const,
  };

  let request$: Observable<HttpResponse<unknown>>;

  if (method === 'GET') {
    request$ = httpClient.get<unknown>(urlWithParams, requestOptions);
  } else {
    let body: string | undefined;
    if (opts.type !== 'query' || opts.methodOverride === 'POST') {
      const input = getInput({
        input: opts.input,
        transformer: opts.transformer,
      });
      body = input !== undefined ? JSON.stringify(input) : undefined;
    }
    request$ = httpClient.post<unknown>(urlWithParams, body, requestOptions);
  }

  return new Promise((resolve, reject) => {
    const subscription = new Subscription();
    let settled = false;
    const cleanup = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      subscription.unsubscribe();
    };
    const resolveRequest = (result: HTTPResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const rejectRequest = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      try {
        throwIfAborted(opts.signal);
      } catch (error) {
        rejectRequest(error);
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }

    subscription.add(
      request$.subscribe({
        next: (response: HttpResponse<unknown>) => {
          if (settled) return;

          const httpResult: HTTPResult = {
            json: response.body,
            meta: createResponseMeta(response, response.body),
          };

          resolveRequest(httpResult);
        },
        error: (error: unknown) => {
          if (settled) return;

          // Handle Angular HttpErrorResponse similar to fetch errors
          if (error instanceof HttpErrorResponse) {
            // Return the actual error response body if available, otherwise create error structure
            const responseBody = error.error || {
              error: {
                message: error.message || 'HTTP Error',
                code: -1,
                data: {
                  code: 'HTTP_ERROR',
                  httpStatus: error.status,
                },
              },
            };

            const httpResult: HTTPResult = {
              json: responseBody,
              meta: createResponseMeta(
                error,
                error.error,
                error.statusText || 'Unknown Error',
              ),
            };

            resolveRequest(httpResult);
          } else {
            // For non-HTTP errors (network issues, etc.), reject directly
            rejectRequest(error);
          }
        },
        complete: () => {
          if (!settled)
            rejectRequest(
              new Error('HTTP request completed without a response'),
            );
        },
      }),
    );
  });
}
