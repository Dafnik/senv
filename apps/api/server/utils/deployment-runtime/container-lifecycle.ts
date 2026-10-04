import { DockerEngine } from '../docker-engine';
import { containerName } from './preview-routes';
import { dockerStreamText } from './docker-logs';
import {
  assertContainerOwned,
  type ContainerOwner,
  type ContainerRole,
} from './container-ownership';

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

  async probeHttp(
    name: string,
    owner: ContainerOwner,
    role: ContainerRole,
    url: string,
    timeoutSeconds: number,
  ): Promise<void> {
    const container = await this.inspectContainer(name);
    if (container) this.assertOwned(container, owner, role);
    else throw new Error(`${name} does not exist.`);
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

  assertOwned(container: ContainerInspect, owner: ContainerOwner, role: ContainerRole): void {
    assertContainerOwned(container, this.instanceId, owner, role);
  }

  async stop(owner: ContainerOwner): Promise<void> {
    await Promise.all(
      (['origin', 'proxy'] as const).map(async (role) => {
        const name = containerName(this.instanceId, owner.id, role);
        const container = await this.inspectContainer(name);
        if (container) this.assertOwned(container, owner, role);
        if (container?.State.Running)
          await this.engine.request(
            'POST',
            `/containers/${encodeURIComponent(container.Id)}/stop?t=5`,
          );
      }),
    );
  }

  async removeOwned(owner: ContainerOwner, role: ContainerRole): Promise<void> {
    const container = await this.inspectContainer(containerName(this.instanceId, owner.id, role));
    if (!container) return;
    this.assertOwned(container, owner, role);
    await this.engine.request(
      'DELETE',
      `/containers/${encodeURIComponent(container.Id)}?force=true&v=false`,
    );
  }

  async removeOrphan(
    containerId: string,
    deploymentId: string,
    role: ContainerRole,
  ): Promise<void> {
    const inspected = await this.inspectId(containerId);
    if (!inspected) return;
    if (!inspected.Config?.Labels?.['senv.project'])
      throw new Error(
        `Refusing to manage orphan ${containerId} without a project ownership label.`,
      );
    this.assertOwned(
      inspected,
      {
        id: deploymentId,
        projectId: inspected.Config.Labels['senv.project'],
      },
      role,
    );
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
