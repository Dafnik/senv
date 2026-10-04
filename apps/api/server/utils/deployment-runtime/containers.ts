import { DockerEngine } from '../docker-engine';
import { ArtifactStore } from './artifacts';
import { createNginxConfig } from './nginx-config';
import type { RuntimeConfig, RuntimeServices } from './contracts';
import { DockerContainerImages } from './container-images';
import { DockerContainerArtifacts } from './container-artifacts';
import { DockerContainerLifecycle, type ContainerInspect } from './container-lifecycle';
import type { ContainerOwner, ContainerRole } from './container-ownership';
export { createStaticOriginNginxConfig } from './static-origin-config';
import { installProxyConfig } from './container-proxy-config';

type DeploymentContainerOptions = {
  engine: DockerEngine;
  instanceId: string;
  networkName: string;
  root: string;
  proxyImage: string;
  artifacts: ArtifactStore;
  services: () => RuntimeServices | undefined;
};

/** Owns Docker image, container, archive, and probe operations for one runtime instance. */
export class DockerDeploymentContainers {
  readonly #options: DeploymentContainerOptions;
  readonly #images: DockerContainerImages;
  readonly #artifacts: DockerContainerArtifacts;
  readonly #lifecycle: DockerContainerLifecycle;

  constructor(options: DeploymentContainerOptions) {
    this.#options = options;
    this.#images = new DockerContainerImages(options.engine, options.services);
    this.#artifacts = new DockerContainerArtifacts(
      options.engine,
      options.root,
      options.artifacts,
      options.services,
    );
    this.#lifecycle = new DockerContainerLifecycle(options.engine, options.instanceId);
  }

  async resolveImage(config: RuntimeConfig): Promise<string> {
    return this.#images.resolve(config);
  }

  async ensureImage(image: string, auth?: RuntimeConfig['registryAuth']): Promise<void> {
    return this.#images.ensure(image, auth);
  }

  async createOrigin(config: RuntimeConfig, name: string, image: string): Promise<string> {
    const isStatic = config.kind === 'static';
    const env = Object.entries({ ...config.env, ...config.secrets }).map(
      ([key, value]) => `${key}=${value}`,
    );
    const created = await this.#options.engine.request<{ Id: string }>(
      'POST',
      `/containers/create?name=${encodeURIComponent(name)}`,
      {
        Image: image,
        ...(isStatic ? {} : { Env: env, ExposedPorts: { [`${config.port}/tcp`]: {} } }),
        Labels: this.#labels(config, 'origin'),
        HostConfig: {
          ...this.#hostConfig(config.limits.origin, config),
          ...(isStatic && process.env['DEPLOYMENT_ARTIFACT_VOLUME']
            ? {
                Mounts: [
                  {
                    Type: 'volume',
                    Source: process.env['DEPLOYMENT_ARTIFACT_VOLUME'],
                    Target: '/var/lib/senv/deployments',
                    ReadOnly: true,
                  },
                ],
              }
            : {}),
        },
      },
    );
    return created.body.Id;
  }

  async createProxy(config: RuntimeConfig, name: string): Promise<string> {
    const created = await this.#options.engine.request<{ Id: string }>(
      'POST',
      `/containers/create?name=${encodeURIComponent(name)}`,
      {
        Image: this.#options.proxyImage,
        Cmd: ['/bin/sh', '-c', 'nginx -t && exec nginx -g "daemon off;"'],
        Labels: this.#labels(config, 'proxy'),
        HostConfig: this.#hostConfig(config.limits.proxy, config),
      },
    );
    return created.body.Id;
  }

  #labels(config: RuntimeConfig, role: 'origin' | 'proxy'): Record<string, string> {
    return {
      'senv.managed': 'true',
      'senv.instance': this.#options.instanceId,
      'senv.deployment': config.id,
      'senv.role': role,
      'senv.project': config.projectId,
    };
  }

  #hostConfig(
    limits: { cpus: string; memoryBytes: number },
    config: RuntimeConfig,
  ): Record<string, unknown> {
    const fileSize = config.logs.fileSizeBytes;
    const files = config.logs.files;
    return {
      NetworkMode: this.#options.networkName,
      Memory: limits.memoryBytes,
      MemorySwap: limits.memoryBytes,
      NanoCpus: Math.max(1, Math.round(Number(limits.cpus) * 1_000_000_000)),
      RestartPolicy: { Name: 'no' },
      LogConfig: {
        Type: 'json-file',
        Config: {
          'max-size': `${Math.max(1, Math.ceil(fileSize / 1024 / 1024))}m`,
          'max-file': String(files),
        },
      },
      SecurityOpt: ['no-new-privileges:true'],
      Init: true,
    };
  }

  async installStaticArtifact(config: RuntimeConfig, containerId: string): Promise<void> {
    return this.#artifacts.install(config, containerId);
  }

  async installStaticOriginConfig(config: RuntimeConfig, containerId: string): Promise<void> {
    return this.#artifacts.installNginxConfig(config, containerId);
  }

  async installProxyConfig(containerId: string, config: string): Promise<void> {
    return installProxyConfig(this.#options.engine, this.#options.root, containerId, config);
  }

  createProxyConfig(config: RuntimeConfig, originName: string): string {
    return createNginxConfig({
      deploymentId: config.id,
      origin: `http://${originName}:${config.port}`,
      settings: config.proxy,
      spaFallback: config.spaFallback,
    });
  }

  async probeHttp(
    containerNameValue: string,
    owner: ContainerOwner,
    role: ContainerRole,
    url: string,
    timeoutSeconds: number,
  ): Promise<void> {
    return this.#lifecycle.probeHttp(containerNameValue, owner, role, url, timeoutSeconds);
  }

  async inspectContainer(name: string): Promise<ContainerInspect | null> {
    return this.#lifecycle.inspectContainer(name);
  }

  async inspectId(id: string): Promise<ContainerInspect | null> {
    return this.#lifecycle.inspectId(id);
  }

  assertOwnedContainer(
    container: ContainerInspect,
    owner: ContainerOwner,
    role: ContainerRole,
  ): void {
    return this.#lifecycle.assertOwned(container, owner, role);
  }

  async stop(owner: ContainerOwner): Promise<void> {
    return this.#lifecycle.stop(owner);
  }

  async removeOwned(owner: ContainerOwner, role: ContainerRole): Promise<void> {
    return this.#lifecycle.removeOwned(owner, role);
  }

  async removeOrphan(
    containerId: string,
    deploymentId: string,
    role: ContainerRole,
  ): Promise<void> {
    return this.#lifecycle.removeOrphan(containerId, deploymentId, role);
  }

  async remove(idOrName: string): Promise<void> {
    return this.#lifecycle.remove(idOrName);
  }
}
