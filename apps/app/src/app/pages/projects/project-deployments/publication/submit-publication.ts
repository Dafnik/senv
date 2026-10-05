import { WritableSignal, Signal } from '@angular/core';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { DeploymentUpload } from '../../../../queries/deployment-upload';
import { DeploymentsData } from '../../../../queries/deployments';
import {
  keepCapturedCredential,
  type PublishDraft,
} from '../project-deployments.form';

export type SubmitPublicationOptions = {
  draft: PublishDraft;
  projectId: string;
  sessionId: string | null;
  currentProjectId: Signal<string>;
  currentSessionId: Signal<string | null>;
  reusable?: PublicDeployment;
  archiveFile: File | null;
  directoryFiles: FileList | null;
  data: DeploymentsData;
  upload: DeploymentUpload;
  busy: WritableSignal<boolean>;
  uploading: WritableSignal<boolean>;
  formError: WritableSignal<string>;
};

export async function submitPublication(
  options: SubmitPublicationOptions,
): Promise<boolean> {
  if (options.busy()) return false;
  options.busy.set(true);
  try {
    const source = {
      commit: options.draft.commit.trim() || undefined,
      branch: options.draft.branch.trim() || undefined,
    };
    let artifactId: string | undefined;
    if (options.draft.kind === 'static' && !options.reusable) {
      options.uploading.set(true);
      const artifact = options.archiveFile
        ? await options.upload.archive(
            options.projectId,
            options.archiveFile,
            source,
          )
        : options.directoryFiles
          ? await options.upload.directory(
              options.projectId,
              options.directoryFiles,
              source,
            )
          : null;
      if (!artifact)
        throw new Error(
          'Choose a ZIP or TAR archive or a built site directory.',
        );
      artifactId = artifact.artifactId;
    }
    if (!isCurrent(options)) return false;

    const credentialOverride =
      options.draft.registryCredentialId === keepCapturedCredential
        ? undefined
        : options.draft.registryCredentialId || null;
    await options.data.publish({
      projectId: options.projectId,
      kind: options.draft.kind,
      ...(options.reusable
        ? {
            reuseDeploymentId: options.reusable.id,
            ...(credentialOverride === undefined
              ? {}
              : { registryCredentialId: credentialOverride }),
          }
        : options.draft.kind === 'static'
          ? { artifactId }
          : {
              image: options.draft.image.trim(),
              registryCredentialId: credentialOverride ?? null,
            }),
      pinned: options.draft.pinned,
      source,
      port: options.draft.port,
    });
    if (!isCurrent(options)) return false;
    await options.data.invalidate(options.sessionId, options.projectId);
    return isCurrent(options);
  } catch (error) {
    if (isCurrent(options)) {
      options.formError.set(
        error instanceof Error
          ? error.message
          : 'The deployment could not be submitted.',
      );
    }
    return false;
  } finally {
    options.uploading.set(false);
    options.busy.set(false);
  }
}

function isCurrent(options: SubmitPublicationOptions) {
  return (
    options.projectId === options.currentProjectId() &&
    options.sessionId === options.currentSessionId()
  );
}
