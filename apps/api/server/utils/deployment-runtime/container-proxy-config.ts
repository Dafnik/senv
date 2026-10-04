import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DockerEngine } from '../docker-engine';
import { writeTarFromDirectory } from './tar';

export async function installProxyConfig(
  engine: DockerEngine,
  root: string,
  containerId: string,
  config: string,
): Promise<void> {
  const temp = await mkdtemp(join(root, 'tmp/proxy-config-'));
  try {
    const files = join(temp, 'files');
    await mkdir(files);
    await writeFile(join(files, 'nginx.conf'), config, { mode: 0o644 });
    const tarPath = join(temp, 'proxy.tar');
    await writeTarFromDirectory(files, tarPath);
    await engine.uploadFile(
      'PUT',
      `/containers/${encodeURIComponent(containerId)}/archive?path=${encodeURIComponent('/etc/nginx')}&noOverwriteDirNonDir=1`,
      tarPath,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
