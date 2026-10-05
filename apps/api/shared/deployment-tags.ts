import * as z from 'zod';

export const deploymentTagNameSchema = z
  .string()
  .regex(/^(?!br-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
