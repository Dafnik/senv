import * as z from 'zod';

export const accountNameMaxLength = 100;
export const passwordMinLength = 8;
export const passwordMaxLength = 128;
export const projectNameMaxLength = 100;

export const accountNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(accountNameMaxLength, `Use ${accountNameMaxLength} characters or fewer.`);
export const emailAddressSchema = z
  .string()
  .trim()
  .min(1, 'Enter an email address.')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));
export const accountPasswordSchema = z.string().superRefine((value, context) => {
  if (!value) {
    context.addIssue({ code: 'custom', message: 'Enter a password.' });
    return;
  }
  if (value.length < passwordMinLength) {
    context.addIssue({
      code: 'custom',
      message: `Use at least ${passwordMinLength} characters.`,
    });
  }
  if (value.length > passwordMaxLength) {
    context.addIssue({
      code: 'custom',
      message: `Use ${passwordMaxLength} characters or fewer.`,
    });
  }
});
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a project name.')
  .max(projectNameMaxLength, `Use ${projectNameMaxLength} characters or fewer.`);
export const previewSlugSchema = z
  .string()
  .min(1, 'Enter a preview slug.')
  .max(63, 'Use 63 characters or fewer.')
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    'Use lowercase letters, digits, and internal hyphens.',
  );
export const accountDetailsSchema = z.object({
  name: accountNameSchema,
  email: emailAddressSchema,
});
export const passwordConfirmationSchema = z
  .object({
    password: accountPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .superRefine((value, context) => {
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords must match.',
      });
    }
  });
