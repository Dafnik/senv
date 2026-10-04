import { DockerEngine } from '../docker-engine';
import { containerName } from './preview-routes';
import { dockerStreamText } from './docker-logs';

export type ContainerInspect = {
  Id: string;
  State: { Running: boolean; Status: string; ExitCode?: number };
  Config?: { Image?: string; Labels?: Record<string, string> };
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> };
};

/** Performs owned-container inspection, health probes, stop, and removal operations. */
export class DockerContainerLifecycle {
  constructor(
    private readonly engine: DockerEngine,
    private readonly instanceId: string,
  ) {}

  async probeHttp(name: string, url: string, timeoutSeconds: number): Promise<void> {
    const container = await this.inspectContainer(name);
    if (!container?.State.Running) throw new Error(`${name} is not running.`);
    const exec = await this.engine.request<{ Id: string }>(
      'POST',
      `/containers/${encodeURIComponent(container.Id)}/exec`,
      {
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        Cmd: ['/bin/busybox', 'wget', '-S', '-O', '/dev/null', '-T', String(timeoutSeconds), url],
      },
    );
    const started = await this.engine.request<Buffer>(
      'POST',
      `/exec/${encodeURIComponent(exec.body.Id)}/start`,
      { Detach: false, Tty: false },
    );
    const inspected = await this.engine.request<{ ExitCode: number | null }>(
      'GET',
      `/exec/${encodeURIComponent(exec.body.Id)}/json`,
    );
    const status = dockerStreamText(
      Buffer.isBuffer(started.body) ? started.body : Buffer.from(String(started.body)),
    ).match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/);
    const code = status?.[1] ? Number(status[1]) : undefined;
    if (inspected.body.ExitCode !== 0 || !code || code < 200 || code >= 300)
      throw new Error(`Health probe ${url} failed${code ? ` with HTTP ${code}` : ''}.`);
  }

  async inspectContainer(name: string): Promise<ContainerInspect | null> {
    try {
      return (
        await this.engine.request<ContainerInspect>(
          'GET',
          `/containers/${encodeURIComponent(name)}/json`,
        )
      ).body;
    } catch (error) {
      if (String(error).includes('(404)')) return null;
      throw error;
    }
  }

  async inspectId(id: string): Promise<ContainerInspect | null> {
    try {
      return (
        await this.engine.request<ContainerInspect>(
          'GET',
          `/containers/${encodeURIComponent(id)}/json`,
        )
      ).body;
    } catch {
      return null;
    }
  }

  assertOwned(container: ContainerInspect, deploymentId: string, role: 'origin' | 'proxy'): void {
    const labels = container.Config?.Labels;
    if (
      labels?.['senv.managed'] !== 'true' ||
      labels['senv.instance'] !== this.instanceId ||
      labels['senv.deployment'] !== deploymentId ||
      labels['senv.role'] !== role
    )
      throw new Error(
        `Refusing to manage container ${container.Id} because its ownership labels do not match this deployment.`,
      );
  }

  async stop(deploymentId: string): Promise<void> {
    await Promise.all(
      (['origin', 'proxy'] as const).map(async (role) => {
        const name = containerName(this.instanceId, deploymentId, role);
        const container = await this.inspectContainer(name);
        if (container) this.assertOwned(container, deploymentId, role);
        if (container?.State.Running)
          await this.engine
            .request('POST', `/containers/${encodeURIComponent(container.Id)}/stop?t=5`)
            .catch(() => {});
      }),
    );
  }

  async removeOwned(deploymentId: string, role: 'origin' | 'proxy'): Promise<void> {
    const container = await this.inspectContainer(
      containerName(this.instanceId, deploymentId, role),
    );
    if (!container) return;
    this.assertOwned(container, deploymentId, role);
    await this.engine.request(
      'DELETE',
      `/containers/${encodeURIComponent(container.Id)}?force=true&v=false`,
    );
  }

  async removeOrphan(
    containerId: string,
    deploymentId: string,
    role: 'origin' | 'proxy',
  ): Promise<void> {
    const inspected = await this.inspectId(containerId);
    if (!inspected) return;
    this.assertOwned(inspected, deploymentId, role);
    await this.engine
      .request('DELETE', `/containers/${encodeURIComponent(containerId)}?force=true&v=false`)
      .catch(() => {});
  }

  async remove(idOrName: string): Promise<void> {
    const container = await this.inspectContainer(idOrName).catch(() => null);
    const id = container?.Id ?? idOrName;
    await this.engine
      .request('DELETE', `/containers/${encodeURIComponent(id)}?force=true&v=false`)
      .catch(() => {});
  }
}
