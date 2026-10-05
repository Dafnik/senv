import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { DeploymentSource } from '@senv/api/shared/deployments';

export type UploadedArtifact = {
  artifactId: string;
  size: number;
  sha256: string;
};

@Injectable({ providedIn: 'root' })
export class DeploymentUpload {
  private readonly http = inject(HttpClient);

  async archive(
    projectId: string,
    file: File,
    source?: DeploymentSource,
  ): Promise<UploadedArtifact> {
    const body = new FormData();
    body.set('projectId', projectId);
    body.set('kind', 'static');
    body.set('file', file, file.name);
    if (source) body.set('source', JSON.stringify(source));
    return this.send(body);
  }

  async directory(
    projectId: string,
    files: FileList,
    source?: DeploymentSource,
  ): Promise<UploadedArtifact> {
    const body = new FormData();
    body.set('projectId', projectId);
    body.set('kind', 'static');
    if (source) body.set('source', JSON.stringify(source));
    if (files.length === 0) throw new Error('The selected directory is empty.');

    const entries: Array<{ file: File; path: string }> = [];
    for (const file of Array.from(files)) {
      const path = (file as File & { webkitRelativePath?: string })
        .webkitRelativePath;
      if (!path) {
        throw new Error('Choose a directory so file paths are preserved.');
      }
      entries.push({ file, path });
    }

    const root = entries[0]?.path.split('/')[0];
    if (!root) {
      throw new Error('Choose a directory so file paths are preserved.');
    }
    for (const { file, path } of entries) {
      if (!path.startsWith(`${root}/`)) {
        throw new Error(
          'The selected directory contains inconsistent file paths.',
        );
      }
      const relativePath = path.slice(root.length + 1);
      if (!relativePath) continue;
      body.append('files', file, relativePath);
    }
    return this.send(body);
  }

  private async send(body: FormData): Promise<UploadedArtifact> {
    const result = await firstValueFrom(
      this.http.post<unknown>(
        `${environment.apiUrl}/api/deployments/artifacts`,
        body,
      ),
    );
    if (
      typeof result !== 'object' ||
      result === null ||
      !('artifactId' in result) ||
      typeof result.artifactId !== 'string' ||
      !('size' in result) ||
      typeof result.size !== 'number' ||
      !('sha256' in result) ||
      typeof result.sha256 !== 'string'
    ) {
      throw new Error('The upload response was invalid. Please try again.');
    }
    return {
      artifactId: result.artifactId,
      size: result.size,
      sha256: result.sha256,
    };
  }
}
