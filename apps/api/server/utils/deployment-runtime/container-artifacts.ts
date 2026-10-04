import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DockerEngine } from '../docker-engine';
import { ArtifactStore } from './artifacts';
import { createStaticOriginNginxConfig } from './static-origin-config';
import { writeTarFromDirectory } from './tar';
import type { RuntimeConfig, RuntimeServices } from './contracts';

/** Transfers retained static artifacts and generated nginx config into origin containers. */
export class DockerContainerArtifacts {
  constructor(
    private readonly engine: DockerEngine,
    private readonly root: string,
    private readonly artifacts: ArtifactStore,
    private readonly services: () => RuntimeServices | undefined,
  ) {}

  async install(config: RuntimeConfig, containerId: string): Promise<void> {
    if (!config.artifactId) throw new Error('Static deployment has no retained artifact.');
    const artifact = await this.services()?.getArtifact(config.artifactId, config.projectId);
    if (!artifact || artifact.projectId !== config.projectId || artifact.kind !== 'static')
      throw new Error('Static deployment artifact is unavailable.');
    const artifactPath = join(this.root, 'artifacts', artifact.storageKey);
    if (!(await this.artifacts.exists(artifact.storageKey)))
      throw new Error('Static deployment artifact files are missing.');
    const temp = await mkdtemp(join(this.root, 'tmp/docker-archive-'));
    try {
      const tarPath = join(temp, 'site.tar');
      await writeTarFromDirectory(artifactPath, tarPath);
      await this.engine.uploadFile(
        'PUT',
        `/containers/${encodeURIComponent(containerId)}/archive?path=${encodeURIComponent('/usr/share/nginx/html')}&noOverwriteDirNonDir=1`,
        tarPath,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  async installNginxConfig(config: RuntimeConfig, containerId: string): Promise<void> {
    const artifact = config.artifactId
      ? await this.services()?.getArtifact(config.artifactId, config.projectId)
      : null;
    if (
      !artifact ||
      artifact.projectId !== config.projectId ||
      artifact.kind !== 'static' ||
      !(await this.artifacts.exists(artifact.storageKey))
    )
      throw new Error('Static deployment artifact is unavailable.');
    const temp = await mkdtemp(join(this.root, 'tmp/static-origin-'));
    try {
      const files = join(temp, 'files');
      await mkdir(join(files, 'conf.d'), { recursive: true });
      const root = process.env['DEPLOYMENT_ARTIFACT_VOLUME']
        ? `/var/lib/senv/deployments/artifacts/${artifact.storageKey}`
        : '/usr/share/nginx/html';
      await writeFile(
        join(files, 'conf.d', 'default.conf'),
        createStaticOriginNginxConfig(config.port, root),
        { mode: 0o644 },
      );
      const tarPath = join(temp, 'origin.tar');
      await writeTarFromDirectory(files, tarPath);
      await this.engine.uploadFile(
        'PUT',
        `/containers/${encodeURIComponent(containerId)}/archive?path=${encodeURIComponent('/etc/nginx')}&noOverwriteDirNonDir=1`,
        tarPath,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}
