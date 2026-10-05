import { inject, Injectable } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query';
import { environment } from '../../environments/environment';
import { injectTrpc } from '../trpc/trpc.service';

export const artifactKeys = (sessionId: string | null, projectId: string) =>
  ['artifacts', sessionId, projectId] as const;

@Injectable({ providedIn: 'root' })
export class ArtifactsData {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);

  list(sessionId: string | null, projectId: string, offset: number) {
    return {
      queryKey: [...artifactKeys(sessionId, projectId), 'list', offset],
      enabled: !!sessionId && !!projectId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.artifacts.list.query(
          { projectId, offset, limit: 50 },
          { signal },
        ),
      refetchInterval: 10_000,
    };
  }

  detail(sessionId: string | null, projectId: string, artifactId: string) {
    return {
      queryKey: [...artifactKeys(sessionId, projectId), 'detail', artifactId],
      enabled: !!sessionId && !!projectId && !!artifactId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.artifacts.detail.query(
          { projectId, artifactId },
          { signal },
        ),
      retry: false,
    };
  }

  directory(
    sessionId: string | null,
    projectId: string,
    artifactId: string,
    path: string,
  ) {
    return {
      queryKey: [
        ...artifactKeys(sessionId, projectId),
        'directory',
        artifactId,
        path,
      ],
      enabled: !!sessionId && !!projectId && !!artifactId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.artifacts.directory.query(
          { projectId, artifactId, path },
          { signal },
        ),
      retry: false,
    };
  }

  file(
    sessionId: string | null,
    projectId: string,
    artifactId: string,
    path: string,
  ) {
    return {
      queryKey: [
        ...artifactKeys(sessionId, projectId),
        'file',
        artifactId,
        path,
      ],
      enabled: !!sessionId && !!projectId && !!artifactId && !!path,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.artifacts.file.query(
          { projectId, artifactId, path },
          { signal },
        ),
      retry: false,
    };
  }

  downloadUrl(
    projectId: string,
    artifactId: string,
    selection: { format: 'zip' | 'tar.gz' } | { path: string },
  ) {
    const query = new URLSearchParams({ projectId, ...selection });
    return `${environment.apiUrl}/api/artifacts/${encodeURIComponent(artifactId)}/download?${query}`;
  }

  invalidate(sessionId: string | null, projectId: string) {
    return this.queryClient.invalidateQueries({
      queryKey: artifactKeys(sessionId, projectId),
    });
  }
}
