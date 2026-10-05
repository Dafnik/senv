import { authRequest, type ClientContext } from '../api/client.ts';
import { readConfiguration } from '../profiles.ts';
import { errorCode } from '../errors.ts';
import { withAddresses } from '../api/addresses.ts';
import { detailLines, safeText, terminalText } from './safety.ts';
import type { DeploymentTab, Row, Screen } from './types.ts';
import {
  addressesDocument,
  detailDocument,
  eventsDocument,
  overviewDocument,
  resourceHistoryDocument,
  resourcesDocument,
} from './deployment-detail.ts';

type Client = ClientContext['client'];
export type Identity = Awaited<ReturnType<Client['me']['query']>>;
export type Access = Awaited<ReturnType<Client['cli']['access']['query']>>;
export type Project = Awaited<ReturnType<Client['cli']['project']['query']>> & { role: string };
export type ProjectCursor = { createdAt: number; id: string };
export type LogEntry = { id: string; sequence: number; content: string; createdAt: Date };
export type User = {
  id: string;
  name: string;
  email: string;
  role?: string;
  banned?: boolean;
  emailVerified?: boolean;
  createdAt?: string;
};
export type Page = { rows: Row[]; hasNext: boolean; cursor?: ProjectCursor };
export type LoadOptions = {
  page: number;
  cursor?: ProjectCursor;
  projectId?: string;
  project?: Project;
  identity: Identity;
  access: Access;
  query: string;
  deploymentFilter: string;
  historyEvent: string;
  historyActor: string;
};
const pageSize = 40;
export function row(
  id: string,
  title: string,
  subtitle: string,
  data: Record<string, unknown>,
  lines = detailLines(data),
): Row {
  return { id, title: safeText(title), subtitle: safeText(subtitle), data, lines };
}
export function deploymentRow(
  deployment:
    | Awaited<ReturnType<Client['deployments']['detail']['query']>>
    | Awaited<ReturnType<Client['deployments']['list']['query']>>['deployments'][number],
) {
  const {
    config: _config,
    configurationChanges: _changes,
    configurationOutdated: _outdated,
    ...safe
  } = withAddresses(deployment);
  // Configuration and environment values are deliberately excluded from TUI state.
  const data = { ...safe };
  delete (data as { history?: unknown }).history;
  return row(
    deployment.id,
    `${deployment.id}  ${deployment.kind}  ${deployment.status}`,
    `${deployment.source.branch ?? deployment.imageDigest ?? ''}  ${deployment.pinned ? 'pinned' : 'unpinned'}`,
    data,
  );
}
export async function selectProject(
  value: ClientContext,
  selection: string,
  identity: Identity,
  access: Access,
): Promise<Project> {
  const project = await value.client.cli.project.query({ project: selection });
  if (access.kind === 'automation') return { ...project, role: access.permission! };
  const detail = await value.client.projects.detail.query({ projectId: project.id });
  return {
    ...project,
    role:
      identity.role === 'admin'
        ? 'admin'
        : (detail.members.find((m) => m.userId === identity.id)?.role ?? 'viewer'),
  };
}
function historyRows(
  entries: Awaited<ReturnType<Client['deployments']['audit']['query']>>['entries'],
) {
  return entries.map((entry) =>
    detailDocument(
      row(
        entry.id,
        `${entry.event}  ${entry.deploymentId}`,
        entry.createdAt.toISOString(),
        { deploymentId: entry.deploymentId, event: entry.event, createdAt: entry.createdAt },
        [],
      ),
      eventsDocument([entry], 'No events recorded yet.'),
    ),
  );
}
export async function loadScreen(
  value: ClientContext,
  screen: Screen,
  options: LoadOptions,
  signal: AbortSignal,
): Promise<Page> {
  const { client } = value;
  const offset = options.page * pageSize;
  const projectId = options.projectId ?? '';
  switch (screen) {
    case 'Projects': {
      if (options.access.kind === 'automation') {
        const p = await client.cli.project.query({ project: options.access.projectId! });
        return { rows: [row(p.id, p.name, p.previewSlug, p)], hasNext: false };
      }
      const result = await client.projects.list.query({
        limit: pageSize,
        cursor: options.cursor as ProjectCursor | undefined,
      });
      return {
        rows: result.projects.map((p) => row(p.id, p.name, p.previewSlug, p)),
        hasNext: Boolean(result.nextCursor),
        cursor: result.nextCursor ?? undefined,
      };
    }
    case 'Deployments': {
      const result = await client.deployments.list.query({ projectId });
      const filtered = result.deployments.filter(
        (d) =>
          (!options.deploymentFilter || d.status === options.deploymentFilter) &&
          (!options.query ||
            safeText(`${d.id} ${d.kind} ${d.imageDigest} ${d.source.branch} ${d.status}`)
              .toLowerCase()
              .includes(options.query.toLowerCase())),
      );
      return {
        rows: filtered.slice(offset, offset + pageSize).map(deploymentRow),
        hasNext: filtered.length > offset + pageSize,
      };
    }
    case 'History': {
      const result = await client.deployments.audit.query({
        projectId,
        limit: pageSize,
        offset,
        search: options.query,
        event: options.historyEvent || undefined,
        actor: options.historyActor || undefined,
      });
      return { rows: historyRows(result.entries), hasNext: result.total > offset + pageSize };
    }
    case 'Members': {
      const result = await client.projects.detail.query({ projectId });
      return {
        rows: result.members
          .slice(offset, offset + pageSize)
          .map((m) => row(m.id, m.user.email, `${m.user.name}  ${m.role}`, { ...m })),
        hasNext: result.members.length > offset + pageSize,
      };
    }
    case 'Invitations': {
      if (!projectId || options.project?.role !== 'admin') return { rows: [], hasNext: false };
      const result = await client.projects.invitations.query({
        projectId,
        offset,
        limit: pageSize,
        search: options.query,
      });
      return {
        rows: result.invitations.map((i) => row(i.id, i.email, `${i.role}  ${i.status}`, i)),
        hasNext: result.total > offset + pageSize,
      };
    }
    case 'Sessions': {
      const result = await client.cli.sessions.query();
      return {
        rows: result
          .slice(offset, offset + pageSize)
          .map((s) =>
            row(
              s.id,
              s.label,
              `${s.kind}${s.current ? '  current' : ''}  expires ${s.expiresAt.toISOString()}`,
              s,
            ),
          ),
        hasNext: result.length > offset + pageSize,
      };
    }
    case 'Automation tokens': {
      const result = await client.cli.tokens.query();
      return {
        rows: result
          .slice(offset, offset + pageSize)
          .map((t) =>
            row(
              t.id,
              t.name,
              `${t.permission}  ${t.revokedAt ? 'revoked' : t.expiresAt && t.expiresAt <= new Date() ? 'expired' : 'active'}  ${terminalText(t.prefix)}`,
              t,
              [
                ...detailLines(t),
                `expiry: ${t.expiresAt?.toISOString() ?? 'Never'}`,
                `prefix: ${terminalText(t.prefix)}`,
              ],
            ),
          ),
        hasNext: result.length > offset + pageSize,
      };
    }
    case 'Users': {
      const result = await authRequest<{ users: User[]; total: number }>(
        value.profile.apiUrl,
        `admin/list-users?limit=${pageSize}&offset=${offset}`,
        value.token,
        undefined,
        {},
        signal,
      );
      return {
        rows: result.users.map((u) =>
          row(u.id, u.email, `${u.name}  ${u.role ?? 'user'}${u.banned ? '  banned' : ''}`, u),
        ),
        hasNext: result.total > offset + pageSize,
      };
    }
    case 'Instance statistics': {
      const data = await client.admin.stats.query();
      return {
        rows: [row('statistics', 'Instance statistics', 'Read only', data)],
        hasNext: false,
      };
    }
    case 'Account': {
      const { id, name, email, role, emailVerified, createdAt } = options.identity;
      const data = {
        id,
        name,
        email,
        role,
        emailVerified,
        createdAt,
        instance: value.name,
        apiUrl: value.profile.apiUrl,
        appUrl: value.profile.appUrl,
        access: options.access.kind,
        impersonated: options.access.impersonated,
      };
      return { rows: [row(id, email, `${name}  ${role}`, data)], hasNext: false };
    }
    case 'Instances': {
      const profiles = Object.entries((await readConfiguration()).profiles);
      return {
        rows: profiles.map(([name, p]) =>
          row(name, name, p.apiUrl, {
            name,
            apiUrl: p.apiUrl,
            appUrl: p.appUrl,
            active: name === value.name,
          }),
        ),
        hasNext: false,
      };
    }
  }
}
export async function loadDeployment(
  value: ClientContext,
  projectId: string,
  deploymentId: string,
  tab: DeploymentTab,
  options: {
    source: 'origin' | 'proxy';
    query: string;
    historyEvent?: string;
    historyActor?: string;
  },
  previous?: Row,
): Promise<Row> {
  const input = { projectId, deploymentId };
  switch (tab) {
    case 'Overview': {
      const deployment = await value.client.deployments.detail.query(input);
      return detailDocument(
        { ...deploymentRow(deployment), subtitle: `Deployment ${deployment.id}` },
        overviewDocument(deployment),
      );
    }
    case 'Addresses': {
      const d = withAddresses(await value.client.deployments.detail.query(input));
      return detailDocument(
        row(
          deploymentId,
          `Addresses for ${deploymentId}`,
          '',
          { previewUrl: d.previewUrl, addresses: d.addresses },
          [],
        ),
        addressesDocument(d.addresses),
      );
    }
    case 'Resources': {
      const [live, history] = await Promise.allSettled([
        value.client.deployments.resources.query(input),
        value.client.deployments.resourceHistory.query(input),
      ]);
      for (const result of [live, history]) {
        if (result.status === 'rejected' && [3, 4].includes(errorCode(result.reason)))
          throw result.reason;
      }
      if (live.status === 'rejected' && history.status === 'rejected') throw live.reason;
      const document = [
        ...(live.status === 'fulfilled'
          ? resourcesDocument(live.value)
          : [
              { kind: 'heading' as const, title: 'Current usage' },
              {
                kind: 'text' as const,
                text: 'Could not load current usage. Press r to retry.',
                tone: 'warning' as const,
              },
            ]),
        ...(history.status === 'fulfilled'
          ? resourceHistoryDocument(history.value)
          : [
              { kind: 'heading' as const, title: 'Resource history' },
              {
                kind: 'text' as const,
                text: 'Could not load historical usage. Press r to retry.',
                tone: 'warning' as const,
              },
            ]),
      ];
      return detailDocument(
        row(
          deploymentId,
          'Origin resources',
          'Live usage and historical trends',
          live.status === 'fulfilled' ? { ...live.value } : {},
          [],
        ),
        document,
      );
    }
    case 'History': {
      const offset = Number(previous?.data.offset ?? 0);
      const result = await value.client.deployments.audit.query({
        ...input,
        search: options.query,
        event: options.historyEvent || undefined,
        actor: options.historyActor || undefined,
        limit: 40,
        offset,
      });
      return detailDocument(
        row(
          deploymentId,
          'Deployment history',
          `${result.total} events | page ${Math.floor(offset / 40) + 1}`,
          { offset, hasNext: result.total > offset + 40 },
          [],
        ),
        eventsDocument(
          result.entries,
          options.query ? 'No events match this search.' : 'No events recorded yet.',
        ),
      );
    }
    case 'Logs':
      return previous ?? row(deploymentId, `Logs for ${deploymentId}`, options.source, {}, []);
  }
}
