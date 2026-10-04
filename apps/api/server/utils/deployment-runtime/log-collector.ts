import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectDockerLogs } from './docker-logs';
import { containerName } from './preview-routes';
import type { DockerEngine } from '../docker-engine';
import type { RuntimeConfig } from './contracts';
import { assertContainerOwned } from './container-ownership';

type LogSource = 'origin' | 'proxy';
type AppendLog = (deploymentId: string, source: LogSource, content: string) => void;

type LogContainer = { Id: string; Config?: { Labels?: Record<string, string> } };

/** Collects Docker output and resumes timestamp cursors across API restarts. */
export class RuntimeLogCollector {
  readonly #logSince = new Map<string, number>();
  readonly #seenLogRows = new Map<string, Set<string>>();

  constructor(readonly options: { engine: DockerEngine; root: string; instanceId: string }) {}

  async loadCursors(): Promise<void> {
    const content = await readFile(join(this.options.root, 'log-cursors.json'), 'utf8').catch(
      () => null,
    );
    if (!content) return;
    try {
      const parsed = JSON.parse(content) as Record<string, number>;
      for (const [key, value] of Object.entries(parsed))
        if (Number.isFinite(value) && value > 0) this.#logSince.set(key, value);
    } catch {
      console.warn('[deployment-runtime] ignoring invalid persisted log cursor file');
    }
  }

  async forgetDeployment(deploymentId: string): Promise<void> {
    for (const source of ['origin', 'proxy'] as const) {
      const key = `${deploymentId}:${source}`;
      this.#logSince.delete(key);
      this.#seenLogRows.delete(key);
    }
    await this.#saveCursors();
  }

  async collectDeployment(config: RuntimeConfig, append: AppendLog): Promise<void> {
    const { id: deploymentId, projectId } = config;
    for (const source of ['origin', 'proxy'] as const) {
      const container = await this.#inspectContainer(
        containerName(this.options.instanceId, deploymentId, source),
      );
      if (!container) continue;
      assertContainerOwned(
        container,
        this.options.instanceId,
        { id: deploymentId, projectId },
        source,
      );
      const key = `${deploymentId}:${source}`;
      const since = this.#logSince.get(key);
      const query = since === undefined ? 'tail=all' : `since=${Math.max(0, since)}`;
      const response = await this.options.engine
        .stream(
          'GET',
          `/containers/${encodeURIComponent(container.Id)}/logs?stdout=1&stderr=1&timestamps=1&${query}`,
        )
        .catch(() => null);
      if (!response) continue;
      const seen = this.#seenLogRows.get(key) ?? new Set<string>();
      let latest = since ?? 0;
      await collectDockerLogs(
        response,
        (content) => append(deploymentId, source, content),
        ({ content, ending, index, recordId, timestamp }) => {
          if (timestamp) latest = Math.max(latest, Date.parse(timestamp) / 1000);
          // Untimestamped output has no stable identity across polls. Preserve it.
          if (!recordId) return true;
          const fingerprint = createHash('sha256')
            .update(recordId)
            .update('\0')
            .update(String(index))
            .update('\0')
            .update(content)
            .update(ending)
            .digest('hex');
          if (seen.has(fingerprint)) return false;
          seen.add(fingerprint);
          if (seen.size > 50_000) seen.delete(seen.values().next().value!);
          return true;
        },
      );
      this.#seenLogRows.set(key, seen);
      if (latest > (since ?? 0)) {
        this.#logSince.set(key, latest);
        await this.#saveCursors();
      }
    }
  }

  async captureContainerLogs(
    config: RuntimeConfig,
    source: LogSource,
    containerId: string | undefined,
    append: AppendLog,
  ): Promise<void> {
    if (!containerId) return;
    const inspected = await this.#inspectContainer(containerId);
    if (!inspected) return;
    assertContainerOwned(
      inspected,
      this.options.instanceId,
      { id: config.id, projectId: config.projectId },
      source,
    );
    const response = await this.options.engine
      .stream(
        'GET',
        `/containers/${encodeURIComponent(inspected.Id)}/logs?stdout=1&stderr=1&timestamps=1&tail=all`,
      )
      .catch(() => null);
    if (!response) return;
    await collectDockerLogs(response, (content) => append(config.id, source, content));
  }

  async #inspectContainer(name: string): Promise<LogContainer | null> {
    try {
      return (
        await this.options.engine.request<LogContainer>(
          'GET',
          `/containers/${encodeURIComponent(name)}/json`,
        )
      ).body;
    } catch (error) {
      if (String(error).includes('(404)')) return null;
      throw error;
    }
  }

  async #saveCursors(): Promise<void> {
    const path = join(this.options.root, 'log-cursors.json');
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(Object.fromEntries(this.#logSince)), { mode: 0o600 });
    await rename(temp, path);
  }
}
