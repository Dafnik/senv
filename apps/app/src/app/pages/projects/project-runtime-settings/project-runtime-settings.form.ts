import * as z from 'zod';
import {
  projectRuntimeUpdateSchema,
  runtimeVariableNameSchema,
  type ProjectRuntimeUpdate,
} from '@senv/api/shared/deployments';

const runtimeDraftSchema = z.object({
  envText: z.string(),
  secrets: z.array(
    z.object({ name: z.string(), value: z.string(), saved: z.boolean() }),
  ),
  removedNames: z.array(z.string()),
});

export type RuntimeDraft = z.infer<typeof runtimeDraftSchema>;

function runtimeUpdateFromDraft(draft: RuntimeDraft): ProjectRuntimeUpdate {
  const env: Record<string, string> = Object.create(null);
  for (const [index, line] of draft.envText.split('\n').entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    const name = line.slice(0, separator).trim();
    if (separator < 1 || !runtimeVariableNameSchema.safeParse(name).success)
      throw new Error(
        `Line ${index + 1}: use KEY=value with a valid variable name.`,
      );
    if (Object.prototype.hasOwnProperty.call(env, name))
      throw new Error(`Line ${index + 1}: ${name} is repeated.`);
    env[name] = line.slice(separator + 1);
  }

  const secrets: Record<string, string> = Object.create(null);
  const names = new Set<string>();
  for (const secret of draft.secrets) {
    const name = secret.name.trim();
    if (!runtimeVariableNameSchema.safeParse(name).success)
      throw new Error('Use a valid name for each secret.');
    if (names.has(name) || Object.prototype.hasOwnProperty.call(env, name))
      throw new Error(
        `${name} is already used by an environment variable or secret.`,
      );
    names.add(name);
    if (!secret.saved && !secret.value)
      throw new Error(`Enter a value for ${name}.`);
    if (secret.value) secrets[name] = secret.value;
  }

  const parsed = projectRuntimeUpdateSchema.safeParse({
    env,
    secrets,
    removeSecretNames: draft.removedNames,
  });
  if (!parsed.success)
    throw new Error('Runtime values cannot exceed 16384 characters.');
  return parsed.data;
}

export const runtimeSettingsFormSchema = runtimeDraftSchema.superRefine(
  (draft, context) => {
    try {
      runtimeUpdateFromDraft(draft);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message:
          error instanceof Error
            ? error.message
            : 'Check runtime configuration.',
      });
    }
  },
);

export function runtimeUpdateFromForm(
  draft: RuntimeDraft,
): ProjectRuntimeUpdate {
  return runtimeUpdateFromDraft(runtimeSettingsFormSchema.parse(draft));
}
