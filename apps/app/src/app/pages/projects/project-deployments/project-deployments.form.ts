import * as z from 'zod';
import {
  deploymentKindSchema,
  publishDeploymentSchema,
} from '@senv/api/shared/deployments';

export type PublishDraft = {
  kind: 'static' | 'container';
  image: string;
  registryCredentialId: string;
  pinned: boolean;
  commit: string;
  branch: string;
  port: number;
  reuseDeploymentId: string;
};

export const keepCapturedCredential = '__keep_captured_credential__';

export function emptyPublishDraft(): PublishDraft {
  return {
    kind: 'static',
    image: '',
    registryCredentialId: '',
    pinned: false,
    commit: '',
    branch: '',
    port: 80,
    reuseDeploymentId: '',
  };
}

const publishDraftShapeSchema = z.object({
  kind: deploymentKindSchema,
  image: z.string(),
  registryCredentialId: z.string(),
  pinned: z.boolean(),
  commit: z.string(),
  branch: z.string(),
  port: z.number(),
  reuseDeploymentId: z.string(),
});

export const publishDraftSchema = publishDraftShapeSchema.superRefine(
  (draft, context) => {
    if (
      draft.kind === 'container' &&
      !draft.reuseDeploymentId &&
      !draft.image.trim()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['image'],
        message: 'Enter a container image.',
      });
    }

    const result = publishDeploymentSchema.safeParse({
      projectId: 'form-validation',
      kind: draft.kind,
      ...(draft.reuseDeploymentId
        ? {
            reuseDeploymentId: draft.reuseDeploymentId,
            ...(draft.registryCredentialId === keepCapturedCredential
              ? {}
              : {
                  registryCredentialId: draft.registryCredentialId || null,
                }),
          }
        : draft.kind === 'container' && draft.image.trim()
          ? {
              image: draft.image,
              registryCredentialId: draft.registryCredentialId || null,
            }
          : {}),
      pinned: draft.pinned,
      source: { commit: draft.commit, branch: draft.branch },
      port: draft.port,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path =
          issue.path[0] === 'source' ? issue.path.slice(1) : issue.path;
        context.addIssue({ code: 'custom', path, message: issue.message });
      }
    }
  },
);

export function restorePublishDraft(
  value: unknown,
  defaults: PublishDraft,
): PublishDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return defaults;
  const stored = value as Partial<PublishDraft> & {
    reuseArtifactId?: unknown;
  };
  const candidate = {
    ...defaults,
    ...stored,
    reuseDeploymentId:
      typeof stored.reuseDeploymentId === 'string'
        ? stored.reuseDeploymentId
        : typeof stored.reuseArtifactId === 'string'
          ? stored.reuseArtifactId
          : defaults.reuseDeploymentId,
  };
  const parsed = publishDraftShapeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : defaults;
}
