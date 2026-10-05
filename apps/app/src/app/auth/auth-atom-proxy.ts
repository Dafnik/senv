import {
  signal,
  type PendingTasks,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type { Atom } from 'better-auth/client';
import { BehaviorSubject, type Observable } from 'rxjs';
import type { SessionQueryParams } from 'better-auth/client';

export interface BaseAtomValue {
  isPending: boolean;
  isRefetching: boolean;
  refetch: (queryParams?: { query?: SessionQueryParams }) => Promise<void>;
}

export interface CachedSignal {
  readonly: Signal<unknown> & Observable<unknown>;
  writable: WritableSignal<unknown>;
  unsubscribe: () => void;
}

export type SignalObservable<Value> = Signal<Value> & Observable<Value>;

export function createAuthAtomProxy<Client extends object>(
  client: Client,
  options: {
    cache: Map<string, CachedSignal>;
    isServer: boolean;
    pendingTasks: PendingTasks;
  },
) {
  type Value = (() => unknown) | Atom<BaseAtomValue> | undefined;

  return new Proxy(client, {
    get: (target, prop: string) => {
      const value = target[prop as keyof typeof target] as Value;
      const cached = options.cache.get(prop);
      if (!value || !isAtom(value)) return value;
      if (cached) return () => cached.readonly;

      const subject = new BehaviorSubject(value.get());
      const observable = subject.asObservable();
      const writable = signal<unknown>(value.get());
      const readonly = new Proxy(writable.asReadonly(), {
        get: (target, property) =>
          Reflect.get(property in target ? target : observable, property),
      }) as SignalObservable<unknown>;
      const atomUnsubscribe = value.subscribe((newValue) => {
        if (!subject.closed) subject.next(newValue);
        writable.set(newValue);
      });
      const unsubscribe = () => {
        atomUnsubscribe();
        subject.complete();
      };

      if (options.isServer && value.get().isPending) {
        options.pendingTasks.run(() => value.get().refetch());
      } else {
        options.pendingTasks.run(
          () => new Promise((resolve) => setTimeout(resolve, 0)),
        );
      }

      options.cache.set(prop, { writable, unsubscribe, readonly });
      return () => options.cache.get(prop)!.readonly;
    },
  });
}

function isAtom(value: unknown): value is Atom<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'get') === 'function' &&
    typeof Reflect.get(value, 'lc') === 'number'
  );
}
