/**
 * https://github.com/better-auth/better-auth/discussions/4115#discussioncomment-15407712
 */
import { isPlatformServer } from '@angular/common';
import {
  HttpClient,
  type HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import {
  DestroyRef,
  DOCUMENT,
  inject,
  Injectable,
  PendingTasks,
  PLATFORM_ID,
  REQUEST,
} from '@angular/core';

import type { ClientFetchOption } from 'better-auth';
import {
  type Atom,
  type BetterAuthClientOptions,
  createAuthClient as createBetterAuthClient,
  type Prettify,
} from 'better-auth/client';
import { catchError, lastValueFrom, map, of } from 'rxjs';
import {
  createAuthAtomProxy,
  type BaseAtomValue,
  type CachedSignal,
  type SignalObservable,
} from './auth-atom-proxy';
import { headersFromFetch, processAuthResponse } from './auth-http-utils';

export type AuthClientOptions = {
  [Key in keyof BetterAuthClientOptions]: Key extends 'fetchOptions'
    ? Omit<ClientFetchOption, 'customFetchImpl'> | undefined
    : BetterAuthClientOptions[Key];
};

/**
 * Creates a specialized Better Auth client for Angular.
 * * Features:
 * - Automatically wraps Atoms (useSession, etc.) into Angular Signals.
 * - Handles SSR by bridging request headers (cookies).
 * - Implements Angular TransferState synchronization via HttpClient.
 * - Manages memory by unsubscribing from stores on service destruction.
 *
 * * @example
 * // Simple usage with options
 * export const AuthClient = createAuthClient({
 *   plugins: [phoneNumberClient(), organizationClient()]
 * });
 *
 * @example
 * // With factory function to inject dependencies
 * export const AuthClient = createAuthClient((router = inject(Router)) => ({
 *   plugins: [phoneNumberClient(), organizationClient()],
 *   fetchOptions: {
 *     onError: ({ error }) => {
 *       router.navigate(['/error'], { state: { error } });
 *     }
 *   }
 * }));
 */
export function createAuthClient<Options extends AuthClientOptions>(
  optionsOrFactory: (() => Options) | Options,
) {
  type Client = ReturnType<typeof createBetterAuthClient<Options>>;

  @Injectable({ providedIn: 'root' })
  class AuthClient {
    private readonly _origin =
      inject(DOCUMENT).defaultView?.location.origin ?? '';
    private readonly _isServer = isPlatformServer(inject(PLATFORM_ID));
    private readonly _cache = new Map<string, CachedSignal>();
    private readonly _pendingTasks = inject(PendingTasks);
    private readonly _destroyRef = inject(DestroyRef);
    private readonly _http = inject(HttpClient);
    private readonly _request = inject(REQUEST);

    readonly client = createAuthAtomProxy(this._createClient(), {
      cache: this._cache,
      isServer: this._isServer,
      pendingTasks: this._pendingTasks,
    });

    constructor() {
      // Clean up all Nanostore subscriptions when the provider is destroyed
      this._destroyRef.onDestroy(() => {
        this._cache.forEach((value) => value.unsubscribe());
        this._cache.clear();
      });
    }

    /**
     * Initializes the core Better Auth client with a custom fetch implementation
     * that delegates to Angular's HttpClient.
     */
    private _createClient() {
      const options =
        typeof optionsOrFactory === 'function'
          ? optionsOrFactory()
          : optionsOrFactory;
      return createBetterAuthClient({
        ...options,
        fetchOptions: {
          ...options.fetchOptions,
          customFetchImpl: async (url, init) => {
            const headers = new HttpHeaders({
              // Bridge native Fetch headers to Angular HttpHeaders
              ...headersFromFetch(init?.headers),

              // Critical: In SSR, 'origin' is mandatory for CSRF protection in Better Auth
              ...(this._request && { origin: this._origin }),

              // Pass cookies and other browser headers to the API during SSR
              ...headersFromFetch(this._request?.headers),
            });

            const path = url.toString().replace(this._origin, '');
            const method = init?.method ?? 'GET';

            return lastValueFrom(
              this._http
                .request(method, path, {
                  ...init,
                  headers,
                  observe: 'response',
                  responseType: 'json',
                })
                .pipe(
                  map((res) => processAuthResponse(res)),
                  catchError((res: HttpErrorResponse) =>
                    of(processAuthResponse(res)),
                  ),
                ),
            );
          },
        },
      } satisfies BetterAuthClientOptions);
    }
  }
  type TypeAuthClient = {
    [Key in keyof Client]: Client[Key] extends Atom<infer V>
      ? () => SignalObservable<
          Key extends 'useSession' ? Prettify<V & BaseAtomValue> : V
        >
      : Client[Key];
  };

  return () => inject(AuthClient).client as TypeAuthClient;
}
