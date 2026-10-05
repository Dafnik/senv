import { and, asc, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import { deploymentHistory } from '../../../../../../drizzle/schema';
import type { DeploymentHistoryQuery } from '../../../../shared/deployment-history';
import type { DeploymentActor, DeploymentHistoryEntry } from '../../../../shared/deployments';
import { db } from '../../../infrastructure/db';

function scopeFilter(input: DeploymentHistoryQuery) {
  return and(
    eq(deploymentHistory.projectId, input.projectId),
    input.deploymentId ? eq(deploymentHistory.deploymentId, input.deploymentId) : undefined,
  );
}

function entryFilter(input: DeploymentHistoryQuery) {
  const search = input.search.toLowerCase();
  return and(
    scopeFilter(input),
    input.cursor === undefined
      ? undefined
      : typeof input.cursor === 'number'
        ? lt(deploymentHistory.createdAt, new Date(input.cursor))
        : or(
            lt(deploymentHistory.createdAt, input.cursor.createdAt),
            and(
              eq(deploymentHistory.createdAt, input.cursor.createdAt),
              lt(deploymentHistory.id, input.cursor.id),
            ),
          ),
    input.event ? eq(deploymentHistory.event, input.event) : undefined,
    input.actor === 'system'
      ? eq(deploymentHistory.actorType, 'system')
      : input.actor
        ? sql`json_extract(${deploymentHistory.actor}, '$.id') = ${input.actor}`
        : undefined,
    search
      ? or(
          sql`instr(lower(${deploymentHistory.event}), ${search}) > 0`,
          sql`instr(lower(${deploymentHistory.deploymentId}), ${search}) > 0`,
          sql`instr(lower(coalesce(json_extract(${deploymentHistory.actor}, '$.name'), 'System')), ${search}) > 0`,
          sql`instr(lower(coalesce(json_extract(${deploymentHistory.actor}, '$.id'), '')), ${search}) > 0`,
          sql`instr(lower(${deploymentHistory.details}), ${search}) > 0`,
        )
      : undefined,
  );
}

export function listDeploymentHistoryPage(input: DeploymentHistoryQuery): {
  entries: DeploymentHistoryEntry[];
  total: number;
  events: string[];
  actors: Array<{ id: string; name: string }>;
} {
  const direction = input.sortDirection === 'asc' ? asc : desc;
  const actorName = sql<string>`coalesce(json_extract(${deploymentHistory.actor}, '$.name'), 'System')`;
  const sortColumns = {
    createdAt: deploymentHistory.createdAt,
    event: deploymentHistory.event,
    deploymentId: deploymentHistory.deploymentId,
    actor: actorName,
  };
  const filter = entryFilter(input);
  const entries = db
    .select()
    .from(deploymentHistory)
    .where(filter)
    .orderBy(direction(sortColumns[input.sortBy]), desc(deploymentHistory.id))
    .limit(input.limit)
    .offset(input.offset)
    .all() as DeploymentHistoryEntry[];
  const total = db.select({ total: count() }).from(deploymentHistory).where(filter).get()!.total;
  const events = db
    .selectDistinct({ event: deploymentHistory.event })
    .from(deploymentHistory)
    .where(scopeFilter(input))
    .orderBy(asc(deploymentHistory.event))
    .all()
    .map((row) => row.event);

  const actorRows = db
    .select({ actorType: deploymentHistory.actorType, actor: deploymentHistory.actor })
    .from(deploymentHistory)
    .where(scopeFilter(input))
    .orderBy(desc(deploymentHistory.createdAt), desc(deploymentHistory.id))
    .all();
  const actors = new Map<string, { id: string; name: string }>();
  for (const row of actorRows) {
    if (row.actorType === 'system') {
      if (!actors.has('system')) actors.set('system', { id: 'system', name: 'System' });
      continue;
    }
    const actor = row.actor as DeploymentActor | null;
    if (actor?.id && actor.name && !actors.has(actor.id))
      actors.set(actor.id, { id: actor.id, name: actor.name });
  }

  return { entries, total, events, actors: [...actors.values()] };
}
