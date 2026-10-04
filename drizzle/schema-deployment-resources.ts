import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { deployment } from './schema-deployments';

export const deploymentResourceSample = sqliteTable(
  'deploymentResourceSample',
  {
    deploymentId: text('deploymentId')
      .notNull()
      .references(() => deployment.id, { onDelete: 'cascade' }),
    sampledAt: integer('sampledAt', { mode: 'timestamp_ms' }).notNull(),
    cpuPercent: real('cpuPercent'),
    memoryUsedBytes: integer('memoryUsedBytes'),
    memoryLimitBytes: integer('memoryLimitBytes'),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.sampledAt] }),
    index('deployment_resource_sample_time_idx').on(table.sampledAt),
  ],
);
