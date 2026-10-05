import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organization, session, user } from './schema-core';
import { createdAt } from './schema-columns';

export const deviceCode = sqliteTable('deviceCode', {
  id: text('id').primaryKey(),
  deviceCode: text('deviceCode').notNull().unique(),
  userCode: text('userCode').notNull().unique(),
  userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  status: text('status').notNull(),
  lastPolledAt: integer('lastPolledAt', { mode: 'timestamp_ms' }),
  pollingInterval: integer('pollingInterval'),
  clientId: text('clientId'),
  scope: text('scope'),
});

export const cliDeviceRequest = sqliteTable('cliDeviceRequest', {
  id: text('id')
    .primaryKey()
    .references(() => deviceCode.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  version: text('version').notNull(),
  approvingSessionId: text('approvingSessionId').references(() => session.id, {
    onDelete: 'cascade',
  }),
});

export const cliSession = sqliteTable('cliSession', {
  id: text('id')
    .primaryKey()
    .references(() => session.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  version: text('version').notNull(),
  lastActivityAt: integer('lastActivityAt', { mode: 'timestamp_ms' }).notNull(),
});

export const automationToken = sqliteTable(
  'automationToken',
  {
    id: text('id').primaryKey(),
    tokenHash: text('tokenHash').notNull().unique(),
    prefix: text('prefix').notNull(),
    name: text('name').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: text('projectId')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    permission: text('permission', { enum: ['read', 'manage'] }).notNull(),
    createdAt: createdAt(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }),
    revokedAt: integer('revokedAt', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('lastUsedAt', { mode: 'timestamp_ms' }),
  },
  (table) => [index('automationToken_userId_idx').on(table.userId)],
);
