import * as z from 'zod';
import { registryServerSchema } from './deployments';

export const registryCredentialNameMaxLength = 100;
export const registryCredentialUsernameMaxLength = 256;
export const registryCredentialSecretMaxLength = 8192;

export const registryCredentialNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name for this credential.')
  .max(
    registryCredentialNameMaxLength,
    `Use ${registryCredentialNameMaxLength} characters or fewer.`,
  );
export const registryCredentialUsernameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a registry username.')
  .max(
    registryCredentialUsernameMaxLength,
    `Use ${registryCredentialUsernameMaxLength} characters or fewer.`,
  );
export const registryCredentialSecretSchema = z
  .string()
  .max(
    registryCredentialSecretMaxLength,
    `Use ${registryCredentialSecretMaxLength} characters or fewer.`,
  )
  .default('');

/** Input fields shared by the API and the project credential form. */
export const registryCredentialInputSchema = z.object({
  id: z.string().optional(),
  name: registryCredentialNameSchema,
  registry: registryServerSchema,
  username: registryCredentialUsernameSchema,
  secret: registryCredentialSecretSchema,
});

/** The add-credential form requires a new secret; API updates may retain one. */
export const newRegistryCredentialFormSchema = registryCredentialInputSchema
  .omit({ id: true })
  .extend({
    secret: z
      .string()
      .min(1, 'Enter the registry access token or password.')
      .max(
        registryCredentialSecretMaxLength,
        `Use ${registryCredentialSecretMaxLength} characters or fewer.`,
      ),
  });

export type RegistryCredentialInput = z.infer<typeof registryCredentialInputSchema>;
