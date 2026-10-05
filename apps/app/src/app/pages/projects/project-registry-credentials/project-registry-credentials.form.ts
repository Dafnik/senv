import {
  MAX_LENGTH,
  REQUIRED,
  metadata,
  schema,
  validateStandardSchema,
} from '@angular/forms/signals';
import {
  newRegistryCredentialFormSchema,
  registryCredentialNameMaxLength,
  registryCredentialSecretMaxLength,
  registryCredentialUsernameMaxLength,
  type RegistryCredentialInput,
} from '@senv/api/shared/deployment-credentials';

export type RegistryCredentialDraft = {
  name: string;
  registry: string;
  username: string;
  secret: string;
};

export const registryCredentialFormSchema = schema<RegistryCredentialDraft>(
  (path) => {
    metadata(path.name, REQUIRED, () => true);
    metadata(path.name, MAX_LENGTH, () => registryCredentialNameMaxLength);
    metadata(path.registry, REQUIRED, () => true);
    metadata(path.username, REQUIRED, () => true);
    metadata(
      path.username,
      MAX_LENGTH,
      () => registryCredentialUsernameMaxLength,
    );
    metadata(path.secret, REQUIRED, () => true);
    metadata(path.secret, MAX_LENGTH, () => registryCredentialSecretMaxLength);
    validateStandardSchema(path, newRegistryCredentialFormSchema);
  },
);

export function toRegistryCredentialInput(
  draft: RegistryCredentialDraft,
): RegistryCredentialInput {
  return newRegistryCredentialFormSchema.parse(draft);
}
