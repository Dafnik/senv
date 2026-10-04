import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { withArtifactStorageLock } from '../deployment-storage-lock';
import { DockerEngine } from '../docker-engine';
import { DockerDeploymentContainers } from './containers';
import type { RuntimeConfig, RuntimeServices } from './contracts';
import { ArtifactStore } from './artifacts';

type EngineContainer = {
  Id: string;
  Labels?: Record<string, string>;
};
type RuntimeCleanupOptions = {
  engine: DockerEngine;
  containers: DockerDeploymentContainers;
  artifacts: ArtifactStore;
  root: string;
  instanceId: string;
  services: () => RuntimeServices | undefined;
};

/** Removes orphaned owned containers and stale artifact files during reconciliation. */
export class RuntimeCleanup {
  constructor(private readonly options: RuntimeCleanupOptions) {}

  async removeOrphanContainers(activeIds: Set<string>): Promise<void> {
    const containers = await this.options.engine.request<EngineContainer[]>(
      'GET',
      `/containers/json?all=1&filters=${encodeURIComponent(
        JSON.stringify({
          label: ['senv.managed=true', `senv.instance=${this.options.instanceId}`],
        }),
      )}`,
    );
    for (const container of containers.body) {
      const id = container.Labels?.['senv.deployment'];
      if (!id || activeIds.has(id)) continue;
      const role = container.Labels?.['senv.role'];
      if (role !== 'origin' && role !== 'proxy') continue;
      await this.options.containers.removeOrphan(container.Id, id, role);
    }
  }

  async removeUnreferencedArtifacts(configs: RuntimeConfig[]): Promise<void> {
    await withArtifactStorageLock(this.options.root, async () => {
      const cleanupState = await this.options.services()?.getArtifactCleanupState();
      const keep = new Set<string>(
        cleanupState?.referenced ??
          configs.map((config) => config.artifactId).filter((id): id is string => Boolean(id)),
      );
      const pending = new Set(cleanupState?.pending ?? []);
      const released = new Set(cleanupState?.released ?? []);
      const artifactRoot = join(this.options.root, 'artifacts');
      const entries = await readdir(artifactRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          !/^[a-f0-9]{64}$/.test(entry.name) ||
          keep.has(entry.name) ||
          pending.has(entry.name)
        )
          continue;
        const info = await stat(join(artifactRoot, entry.name)).catch(() => null);
        if (released.has(entry.name) || (info && info.mtimeMs < Date.now() - 24 * 60 * 60 * 1000)) {
          await this.options.artifacts.remove(entry.name);
          await this.options.services()?.forgetArtifactStorageKey?.(entry.name);
        }
      }
    });

    const tempRoot = join(this.options.root, 'tmp');
    const temps = await readdir(tempRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of temps) {
      if (!entry.isDirectory()) continue;
      const path = join(tempRoot, entry.name);
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < Date.now() - 60 * 60 * 1000)
        await rm(path, { recursive: true, force: true });
    }
  }
}
