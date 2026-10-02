import {
  apply,
  email,
  maxLength,
  minLength,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import {
  accountNameMaxLength,
  passwordMaxLength,
  passwordMinLength,
  projectNameMaxLength,
} from '@senv/api/shared/validation';

export const emailAddressSchema = schema<string>((p) => {
  required(p, { message: 'Enter an email address.' });
  email(p, { message: 'Enter a valid email address.' });
});

export const accountDetailsSchema = schema<{
  name: string;
  email: string;
}>((p) => {
  required(p.name, { message: 'Enter a name.' });
  maxLength(p.name, accountNameMaxLength, {
    message: `Use ${accountNameMaxLength} characters or fewer.`,
  });
  validate(p.name, ({ value }) =>
    !value() || value().trim()
      ? null
      : { kind: 'required', message: 'Enter a name.' },
  );
  apply(p.email, emailAddressSchema);
});

export const passwordSchema = schema<string>((p) => {
  required(p, { message: 'Enter a password.' });
  minLength(p, passwordMinLength, {
    message: `Use at least ${passwordMinLength} characters.`,
  });
  maxLength(p, passwordMaxLength, {
    message: `Use ${passwordMaxLength} characters or fewer.`,
  });
});

export const projectNameSchema = schema<string>((p) => {
  required(p, { message: 'Enter a project name.' });
  maxLength(p, projectNameMaxLength, {
    message: `Use ${projectNameMaxLength} characters or fewer.`,
  });
  validate(p, ({ value }) =>
    !value() || value().trim()
      ? null
      : { kind: 'required', message: 'Enter a project name.' },
  );
});

export const passwordConfirmationSchema = schema<{
  password: string;
  confirmPassword: string;
}>((p) => {
  apply(p.password, passwordSchema);
  required(p.confirmPassword, { message: 'Confirm your password.' });
  validate(p.confirmPassword, ({ value, valueOf }) =>
    value() === valueOf(p.password)
      ? null
      : { kind: 'passwordMismatch', message: 'Passwords must match.' },
  );
});
