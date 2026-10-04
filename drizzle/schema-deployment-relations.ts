import type { DeploymentActor } from '../apps/api/shared/deployments';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization } from './schema-core';
import { deployment } from './schema-deployments';
import { createdAt, jsonText, updatedAt } from './schema-columns';

export const deploymentRegistryCredential = sqliteTable(
  'deploymentRegistryCredential',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    registry: text('registry').notNull(),
    username: text('username').notNull(),
    ciphertext: text('ciphertext').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('deployment_registry_project_name_idx').on(table.projectId, table.name)],
);

export const deploymentBranchAlias = sqliteTable(
  'deploymentBranchAlias',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    alias: text('alias').notNull(),
    deploymentId: text('deploymentId').references(() => deployment.id, { onDelete: 'set null' }),
    selectionOrder: integer('selectionOrder').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('deployment_branch_project_branch_idx').on(table.projectId, table.branch),
    uniqueIndex('deployment_branch_project_alias_idx').on(table.projectId, table.alias),
  ],
);

export const deploymentTag = sqliteTable(
  'deploymentTag',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    deploymentId: text('deploymentId')
      .notNull()
      .references(() => deployment.id, { onDelete: 'cascade' }),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('deployment_tag_project_name_idx').on(table.projectId, table.name),
    index('deployment_tag_deployment_idx').on(table.deploymentId),
  ],
);

export const deploymentHistory = sqliteTable(
  'deploymentHistory',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    deploymentId: text('deploymentId').notNull(),
    event: text('event').notNull(),
    actorType: text('actorType').$type<'user' | 'system'>().notNull().default('system'),
    actor: text('actor', { mode: 'json' }).$type<DeploymentActor>(),
    details: jsonText<Record<string, unknown>>('details'),
    createdAt: createdAt(),
  },
  (table) => [
    index('deployment_history_project_time_idx').on(table.projectId, table.createdAt),
    index('deployment_history_deployment_idx').on(table.deploymentId),
  ],
);

export const deploymentLog = sqliteTable(
  'deploymentLog',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    deploymentId: text('deploymentId')
      .notNull()
      .references(() => deployment.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    content: text('content').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('deployment_log_deployment_sequence_idx').on(
      table.deploymentId,
      table.source,
      table.sequence,
    ),
  ],
);
