import {
  MAX_LENGTH,
  MIN_LENGTH,
  REQUIRED,
  metadata,
  schema,
  validateStandardSchema,
} from '@angular/forms/signals';
import {
  accountNameMaxLength,
  accountDetailsSchema as accountDetailsValueSchema,
  accountPasswordSchema,
  emailAddressSchema as emailAddressValueSchema,
  passwordMaxLength,
  passwordMinLength,
  passwordConfirmationSchema as passwordConfirmationValueSchema,
  projectNameMaxLength,
  projectNameSchema as projectNameValueSchema,
} from '@senv/api/shared/validation';

export const emailAddressSchema = schema<string>((path) => {
  metadata(path, REQUIRED, () => true);
  validateStandardSchema(path, emailAddressValueSchema);
});

export const accountDetailsSchema = schema<{ name: string; email: string }>(
  (path) => {
    metadata(path.name, REQUIRED, () => true);
    metadata(path.name, MAX_LENGTH, () => accountNameMaxLength);
    metadata(path.email, REQUIRED, () => true);
    validateStandardSchema(path, accountDetailsValueSchema);
  },
);

export const passwordSchema = schema<string>((path) => {
  metadata(path, REQUIRED, () => true);
  metadata(path, MIN_LENGTH, () => passwordMinLength);
  metadata(path, MAX_LENGTH, () => passwordMaxLength);
  validateStandardSchema(path, accountPasswordSchema);
});

export const projectNameSchema = schema<string>((path) => {
  metadata(path, REQUIRED, () => true);
  metadata(path, MAX_LENGTH, () => projectNameMaxLength);
  validateStandardSchema(path, projectNameValueSchema);
});

export const passwordConfirmationSchema = schema<{
  password: string;
  confirmPassword: string;
}>((path) => {
  metadata(path.password, REQUIRED, () => true);
  metadata(path.password, MIN_LENGTH, () => passwordMinLength);
  metadata(path.password, MAX_LENGTH, () => passwordMaxLength);
  metadata(path.confirmPassword, REQUIRED, () => true);
  validateStandardSchema(path, passwordConfirmationValueSchema);
});
