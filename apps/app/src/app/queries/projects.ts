import { inject, Injectable } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query';
import type { ProjectRole } from '@senv/api/shared/project-permissions';
import { injectAuthClient } from '../auth/auth-client';
import { unwrapAuthResult } from '../auth/auth-result';
import { injectTrpc, type TrpcService } from '../trpc/trpc.service';

export const projectKeys = {
  list: (sessionId: string | null) => ['projects', sessionId] as const,
  detail: (sessionId: string | null, projectId: string) =>
    ['project', sessionId, projectId] as const,
  invitations: (sessionId: string | null, projectId: string) =>
    ['project-invitations', sessionId, projectId] as const,
};
@Injectable({ providedIn: 'root' })
export class ProjectsData {
  private readonly auth = injectAuthClient();
  private readonly trpc = injectTrpc();
  private readonly queries = inject(QueryClient);
  list(sessionId: string | null) {
    type ProjectCursor = NonNullable<
      Awaited<
        ReturnType<TrpcService['client']['projects']['list']['query']>
      >['nextCursor']
    >;
    return {
      queryKey: projectKeys.list(sessionId),
      enabled: !!sessionId,
      initialPageParam: undefined as ProjectCursor | undefined,
      queryFn: ({
        pageParam,
        signal,
      }: {
        pageParam: ProjectCursor | undefined;
        signal: AbortSignal;
      }) =>
        this.trpc.client.projects.list.query(
          { cursor: pageParam, limit: 40 },
          { signal },
        ),
      getNextPageParam: (
        page: Awaited<
          ReturnType<TrpcService['client']['projects']['list']['query']>
        >,
      ) => page.nextCursor ?? undefined,
    };
  }
  invitations(
    sessionId: string | null,
    input: Parameters<
      TrpcService['client']['projects']['invitations']['query']
    >[0],
  ) {
    return {
      queryKey: [...projectKeys.invitations(sessionId, input.projectId), input],
      enabled: !!sessionId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.projects.invitations.query(input, { signal }),
    };
  }
  async create(name: string) {
    return unwrapAuthResult(
      await this.auth.organization.create({ name, slug: crypto.randomUUID() }),
    );
  }
  async invalidateInvitations(sessionId: string | null, projectId: string) {
    await this.queries.invalidateQueries({
      queryKey: projectKeys.invitations(sessionId, projectId),
    });
  }
  detail(sessionId: string | null, projectId: string) {
    return {
      queryKey: projectKeys.detail(sessionId, projectId),
      enabled: !!sessionId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.projects.detail.query({ projectId }, { signal }),
    };
  }
  async invalidate(sessionId: string | null, projectId?: string) {
    await Promise.all([
      this.queries.invalidateQueries({ queryKey: projectKeys.list(sessionId) }),
      ...(projectId
        ? [
            this.queries.invalidateQueries({
              queryKey: projectKeys.detail(sessionId, projectId),
            }),
            this.queries.invalidateQueries({
              queryKey: projectKeys.invitations(sessionId, projectId),
            }),
          ]
        : []),
    ]);
  }
  rename(projectId: string, name: string) {
    return this.trpc.client.projects.rename.mutate({ projectId, name });
  }
  changeRole(projectId: string, memberId: string, role: ProjectRole) {
    return this.trpc.client.projects.changeMemberRole.mutate({
      projectId,
      memberId,
      role,
    });
  }
  removeMember(projectId: string, memberId: string) {
    return this.trpc.client.projects.removeMember.mutate({
      projectId,
      memberId,
    });
  }
  invite(projectId: string, email: string, role: ProjectRole) {
    return this.trpc.client.projects.invite.mutate({ projectId, email, role });
  }
  cancelInvitation(projectId: string, invitationId: string) {
    return this.trpc.client.projects.cancelInvitation.mutate({
      projectId,
      invitationId,
    });
  }
}
