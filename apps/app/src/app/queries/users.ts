import { inject, Injectable } from '@angular/core';
import { injectQuery, QueryClient } from '@tanstack/angular-query';
import { injectAuthClient, injectAuthSessionId } from '../auth/auth-client';
import { unwrapAuthResult } from '../auth/auth-result';
import { injectTrpc } from '../trpc/trpc.service';

export const userKeys = {
  all: ['users'] as const,
  stats: ['user-stats'] as const,
  list: (sessionId: string | null, query: unknown) =>
    ['users', sessionId, query] as const,
};
@Injectable({ providedIn: 'root' })
export class UsersData {
  private readonly auth = injectAuthClient();
  private readonly queries = inject(QueryClient);
  list(
    sessionId: string | null,
    query: NonNullable<
      Parameters<ReturnType<typeof injectAuthClient>['admin']['listUsers']>[0]
    >['query'],
  ) {
    return {
      queryKey: userKeys.list(sessionId, query),
      enabled: !!sessionId,
      queryFn: async () =>
        unwrapAuthResult(await this.auth.admin.listUsers({ query })),
    };
  }
  async create(name: string, email: string) {
    return unwrapAuthResult(
      await this.auth.admin.createUser({ name, email, role: 'user' }),
    );
  }
  async invalidate() {
    await Promise.all([
      this.queries.invalidateQueries({ queryKey: userKeys.all }),
      this.queries.invalidateQueries({ queryKey: userKeys.stats }),
    ]);
  }
  async remove(userId: string) {
    return unwrapAuthResult(await this.auth.admin.removeUser({ userId }));
  }
  async setRole(userId: string, role: 'user' | 'admin') {
    const result = unwrapAuthResult(
      await this.auth.admin.setRole({ userId, role }),
    );
    return result;
  }
}

export function injectUserStats() {
  const trpc = injectTrpc();
  const sessionId = injectAuthSessionId();
  return injectQuery(() => ({
    queryKey: [...userKeys.stats, sessionId()],
    enabled: !!sessionId(),
    queryFn: ({ signal }) =>
      trpc.client.admin.stats.query(undefined, { signal }),
  }));
}
