import type { DeploymentHealth, DeploymentProxy } from '../apps/api/shared/deployments';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organization } from './schema-core';
import { jsonText, updatedAt } from './schema-columns';

export const projectDeploymentSettings = sqliteTable('projectDeploymentSettings', {
  projectId: text('projectId')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  repository: text('repository'),
  repositoryProvider: text('repositoryProvider', { enum: ['github', 'gitlab', 'forgejo', 'gitea'] })
    .notNull()
    .default('github'),
  spaFallback: integer('spaFallback', { mode: 'boolean' }).notNull().default(false),
  retentionDays: integer('retentionDays').notNull().default(7),
  originCpus: text('originCpus').notNull().default('1'),
  originMemoryBytes: integer('originMemoryBytes').notNull().default(536870912),
  health: jsonText<DeploymentHealth>('health'),
  proxy: jsonText<DeploymentProxy>('proxy'),
  updatedAt: updatedAt(),
});

export const projectDeploymentRuntime = sqliteTable('projectDeploymentRuntime', {
  projectId: text('projectId')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  env: jsonText<Record<string, string>>('env').notNull().default({}),
  secretsCiphertext: text('secretsCiphertext'),
  updatedAt: updatedAt(),
});

export const deploymentInstanceDefaults = sqliteTable('deploymentInstanceDefaults', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uploadLimitBytes: integer('uploadLimitBytes').notNull().default(104857600),
  proxyCpus: text('proxyCpus').notNull().default('0.1'),
  proxyMemoryBytes: integer('proxyMemoryBytes').notNull().default(67108864),
  logFiles: integer('logFiles').notNull().default(3),
  logFileSizeBytes: integer('logFileSizeBytes').notNull().default(10485760),
  updatedAt: updatedAt(),
});
