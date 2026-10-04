/**
 * All credit goes to the awesome trpc-link-angular plugin https://github.com/heddendorp/trpc-angular/tree/main/projects/trpc-link-angular
 */
import { HttpClient } from '@angular/common/http';
import type { HTTPHeaders, Operation, TRPCLink } from '@trpc/client';
import { TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type {
  AnyClientTypes,
  AnyRouter,
  TRPCResponse,
} from '@trpc/server/unstable-core-do-not-import';
import { transformResult } from '@trpc/server/unstable-core-do-not-import';
import { resolveHTTPLinkOptions, type HTTPLinkBaseOptions } from './http-utils';
import { angularHttpRequester } from './angular-http-requester';

export type AngularHttpLinkOptions<TRoot extends AnyClientTypes> =
  HTTPLinkBaseOptions<TRoot> & {
    /**
     * Angular HttpClient instance
     */
    httpClient: HttpClient;
    /**
     * Headers to be set on outgoing requests or a callback that returns said headers
     */
    headers?:
      | HTTPHeaders
      | ((opts: { op: Operation }) => HTTPHeaders | Promise<HTTPHeaders>);
  };

/**
 * Angular HttpClient link for tRPC client
 */
export function angularHttpLink<TRouter extends AnyRouter = AnyRouter>(
  opts: AngularHttpLinkOptions<TRouter['_def']['_config']['$types']>,
): TRPCLink<TRouter> {
  const resolvedOpts = resolveHTTPLinkOptions(opts);

  return () => {
    return ({ op }) => {
      return observable((observer) => {
        const { path, input, type } = op;

        /* istanbul ignore if -- @preserve */
        if (type === 'subscription') {
          throw new Error(
            'Subscriptions are unsupported by `angularHttpLink` - use `httpSubscriptionLink` or `wsLink`',
          );
        }

        const controller = new AbortController();
        const onAbort = () => controller.abort(op.signal?.reason);
        if (op.signal?.aborted) {
          onAbort();
        } else {
          op.signal?.addEventListener('abort', onAbort, { once: true });
        }

        const resolveHeaders = async (): Promise<HTTPHeaders> => {
          if (!opts.headers) {
            return {};
          }
          if (typeof opts.headers === 'function') {
            return opts.headers({ op });
          }
          return opts.headers;
        };

        resolveHeaders()
          .then((headers) => {
            return angularHttpRequester(opts.httpClient, {
              ...resolvedOpts,
              type,
              path,
              input,
              signal: controller.signal,
              headers,
              methodOverride: resolvedOpts.methodOverride,
            });
          })
          .then((res) => {
            const transformed = transformResult(
              res.json as TRPCResponse,
              resolvedOpts.transformer.output,
            );

            if (!transformed.ok) {
              observer.error(
                TRPCClientError.from(transformed.error, {
                  meta: res.meta,
                }),
              );
              return;
            }

            observer.next({
              context: res.meta,
              result: transformed.result,
            });
            observer.complete();
          })
          .catch((cause) => {
            observer.error(TRPCClientError.from(cause, { meta: undefined }));
          });

        return () => {
          op.signal?.removeEventListener('abort', onAbort);
          controller.abort();
        };
      });
    };
  };
}
