import type {
  DeploymentActor,
  DeploymentKind,
  DeploymentSnapshot,
  DeploymentSource,
  DeploymentStatus,
} from '../apps/api/shared/deployments';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organization } from './schema-core';
import { createdAt, jsonText, updatedAt } from './schema-columns';

export const deploymentArtifact = sqliteTable('deploymentArtifact', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<DeploymentKind>().notNull(),
  storageKey: text('storageKey').notNull(),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  source: text('source', { mode: 'json' }).$type<DeploymentSource>(),
  publishedAt: integer('publishedAt', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
});

export const deployment = sqliteTable(
  'deployment',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    artifactId: text('artifactId').references(() => deploymentArtifact.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<DeploymentKind>().notNull(),
    status: text('status').$type<DeploymentStatus>().notNull().default('queued'),
    desiredState: text('desiredState').$type<'running' | 'stopped'>().notNull().default('running'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    submittedAt: integer('submittedAt', { mode: 'timestamp_ms' }).notNull(),
    submissionOrder: integer('submissionOrder').notNull(),
    readyAt: integer('readyAt', { mode: 'timestamp_ms' }),
    retentionStartedAt: integer('retentionStartedAt', { mode: 'timestamp_ms' }),
    retentionDeadlineAt: integer('retentionDeadlineAt', { mode: 'timestamp_ms' }),
    cleanupStartedAt: integer('cleanupStartedAt', { mode: 'timestamp_ms' }),
    cleanupAction: text('cleanupAction').$type<'delete' | 'clean'>(),
    cleanupActor: text('cleanupActor', { mode: 'json' }).$type<DeploymentActor>(),
    source: jsonText<DeploymentSource>('source'),
    snapshot: jsonText<DeploymentSnapshot>('snapshot'),
    imageDigest: text('imageDigest'),
    failureReason: text('failureReason'),
    deletedAt: integer('deletedAt', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('deployment_project_submitted_idx').on(table.projectId, table.submissionOrder),
    index('deployment_retention_idx').on(table.retentionDeadlineAt),
  ],
);

export const deploymentSecret = sqliteTable('deploymentSecret', {
  deploymentId: text('deploymentId')
    .primaryKey()
    .references(() => deployment.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  updatedAt: updatedAt(),
});
