import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  DeploymentActor,
  DeploymentKind,
  DeploymentStatus,
  DeploymentLifetime,
  DeploymentHealth,
  DeploymentProxy,
  DeploymentSnapshot,
  PublishDeploymentInput,
} from '../apps/api/shared/deployments';

const createdAt = () =>
  integer('createdAt', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);
const updatedAt = () =>
  integer('updatedAt', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`)
    .$onUpdate(() => new Date());

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  role: text('role'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('banReason'),
  banExpires: integer('banExpires', { mode: 'timestamp_ms' }),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonatedBy'),
    activeOrganizationId: text('activeOrganizationId'),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organization = sqliteTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  previewSlug: text('previewSlug').notNull().default('').unique(),
  logo: text('logo'),
  createdAt: createdAt(),
  metadata: text('metadata'),
});

const jsonText = <T>(name: string) => text(name, { mode: 'json' }).$type<T>().notNull();

export const projectDeploymentSettings = sqliteTable('projectDeploymentSettings', {
  projectId: text('projectId')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  repository: text('repository'),
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

export const deploymentArtifact = sqliteTable('deploymentArtifact', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<DeploymentKind>().notNull(),
  storageKey: text('storageKey').notNull(),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
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
    lifetime: text('lifetime').$type<DeploymentLifetime>().notNull(),
    submittedAt: integer('submittedAt', { mode: 'timestamp_ms' }).notNull(),
    submissionOrder: integer('submissionOrder').notNull(),
    readyAt: integer('readyAt', { mode: 'timestamp_ms' }),
    retentionStartedAt: integer('retentionStartedAt', { mode: 'timestamp_ms' }),
    retentionDeadlineAt: integer('retentionDeadlineAt', { mode: 'timestamp_ms' }),
    cleanupStartedAt: integer('cleanupStartedAt', { mode: 'timestamp_ms' }),
    cleanupAction: text('cleanupAction'),
    cleanupActor: text('cleanupActor', { mode: 'json' }).$type<DeploymentActor>(),
    source: jsonText<PublishDeploymentInput['source'] & { repository?: string }>('source'),
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
    actorType: text('actorType').notNull().default('unknown'),
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
    id: text('id').primaryKey(),
    deploymentId: text('deploymentId')
      .notNull()
      .references(() => deployment.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    content: text('content').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('deployment_log_deployment_time_idx').on(table.deploymentId, table.createdAt)],
);

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organizationId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('viewer'),
    invitedById: text('invitedById').references(() => user.id, { onDelete: 'set null' }),
    invitedByName: text('invitedByName'),
    createdAt: createdAt(),
  },
  (table) => [
    index('member_organizationId_idx').on(table.organizationId),
    index('member_userId_idx').on(table.userId),
    uniqueIndex('member_organizationId_userId_idx').on(table.organizationId, table.userId),
  ],
);

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organizationId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    inviterId: text('inviterId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
);
