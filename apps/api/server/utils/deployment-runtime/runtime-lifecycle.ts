import { DockerEngine } from '../docker-engine';
import { RuntimeLogCollector } from './log-collector';
import { DockerDeploymentContainers } from './containers';
import { containerName } from './preview-routes';
import type { RuntimeConfig, RuntimeServices } from './contracts';
import { safeError } from './runtime-errors';
import { ContainerOwnershipError } from './container-ownership';

type HealthState = { startedAt: number; readyAt: number | null; failures: number; nextAt: number };
type LifecycleOptions = {
  engine: DockerEngine;
  containers: DockerDeploymentContainers;
  logs: RuntimeLogCollector;
  services: () => RuntimeServices | undefined;
  removing: Set<string>;
  instanceId: string;
  staticOriginImage: string;
  proxyImage: string;
  appendLog: (deploymentId: string, source: 'origin' | 'proxy', content: string) => void;
};

/** Starts origins and proxies, then tracks health transitions for active deployments. */
export class RuntimeDeploymentLifecycle {
  readonly #health = new Map<string, HealthState>();

  private readonly engine: DockerEngine;
  private readonly containers: DockerDeploymentContainers;
  private readonly logs: RuntimeLogCollector;
  private readonly services: () => RuntimeServices | undefined;
  private readonly removing: Set<string>;
  private readonly instanceId: string;
  private readonly staticOriginImage: string;
  private readonly proxyImage: string;
  private readonly appendLog: LifecycleOptions['appendLog'];

  constructor(options: LifecycleOptions) {
    this.engine = options.engine;
    this.containers = options.containers;
    this.logs = options.logs;
    this.services = options.services;
    this.removing = options.removing;
    this.instanceId = options.instanceId;
    this.staticOriginImage = options.staticOriginImage;
    this.proxyImage = options.proxyImage;
    this.appendLog = options.appendLog;
  }

  forget(deploymentId: string): void {
    this.#health.delete(deploymentId);
  }

  async start(config: RuntimeConfig): Promise<RuntimeConfig | null> {
    const started = await this.services()?.markDeploymentStarting(config.id);
    if (!started || started.desiredState !== 'running' || this.removing.has(config.id)) return null;
    config = started;
    const originName = containerName(this.instanceId, config.id, 'origin');
    const proxyName = containerName(this.instanceId, config.id, 'proxy');
    this.#health.set(config.id, {
      startedAt: Date.now(),
      readyAt: null,
      failures: 0,
      nextAt: Date.now(),
    });
    const [existingOrigin, existingProxy] = await Promise.all([
      this.containers.inspectContainer(originName),
      this.containers.inspectContainer(proxyName),
    ]);
    if (existingOrigin) this.containers.assertOwnedContainer(existingOrigin, config, 'origin');
    if (existingProxy) this.containers.assertOwnedContainer(existingProxy, config, 'proxy');
    await this.containers.removeOwned(config, 'origin');
    await this.containers.removeOwned(config, 'proxy');
    const created: string[] = [];
    try {
      const originImage =
        config.kind === 'static'
          ? this.staticOriginImage
          : await this.containers.resolveImage(config);
      if (config.kind === 'static') await this.containers.ensureImage(originImage);
      await this.containers.ensureImage(this.proxyImage);
      const originId = await this.containers.createOrigin(config, originName, originImage);
      created.push(originId);
      if (config.kind === 'static') {
        if (!process.env['DEPLOYMENT_ARTIFACT_VOLUME'])
          await this.containers.installStaticArtifact(config, originId);
        await this.containers.installStaticOriginConfig(config, originId);
      }

      const proxyConfig = this.containers.createProxyConfig(config, originName);
      const proxyId = await this.containers.createProxy(config, proxyName);
      created.push(proxyId);
      await this.containers.installProxyConfig(proxyId, proxyConfig);
      await this.engine.request('POST', `/containers/${encodeURIComponent(originId)}/start`);
      await this.engine.request('POST', `/containers/${encodeURIComponent(proxyId)}/start`);
      const [originState, proxyState] = await Promise.all([
        this.containers.inspectId(originId),
        this.containers.inspectId(proxyId),
      ]);
      if (!originState?.State.Running || !proxyState?.State.Running)
        throw new Error('Origin or proxy container exited during startup.');
      const state = this.#health.get(config.id);
      if (state) state.nextAt = Date.now();
      return config;
    } catch (error) {
      await this.logs
        .captureContainerLogs(config, 'origin', created[0], this.appendLog)
        .catch(() => {});
      await this.logs
        .captureContainerLogs(config, 'proxy', created[1], this.appendLog)
        .catch(() => {});
      await Promise.allSettled(created.map((id) => this.containers.remove(id)));
      await this.services()?.markDeploymentFailed(config.id, safeError(error));
      throw error;
    }
  }

  async probe(config: RuntimeConfig, originName: string, proxyName: string): Promise<void> {
    const current = this.services()?.getDeploymentRuntimeConfig(config.id);
    if (!current || current.desiredState !== 'running' || this.removing.has(config.id)) return;
    config = current;
    const now = Date.now();
    let state = this.#health.get(config.id);
    if (!state) {
      const healthy = config.status === 'healthy' || config.status === 'unhealthy';
      state = { startedAt: now, readyAt: healthy ? now : null, failures: 0, nextAt: 0 };
      this.#health.set(config.id, state);
    }
    if (now < state.nextAt) return;
    state.nextAt = now + config.health.intervalSeconds * 1000;
    try {
      const origin = await this.containers.inspectContainer(originName);
      if (!origin) throw new Error(`${originName} does not exist.`);
      this.containers.assertOwnedContainer(origin, config, 'origin');
      const proxy = await this.containers.inspectContainer(proxyName);
      if (!proxy) throw new Error(`${proxyName} does not exist.`);
      this.containers.assertOwnedContainer(proxy, config, 'proxy');
      await this.containers.probeHttp(
        proxyName,
        config,
        'proxy',
        `http://${originName}:${config.port}${config.health.path}`,
        config.health.timeoutSeconds,
      );
      const proxyHealthPath = `http://127.0.0.1/_senv_health/${encodeURIComponent(config.id)}`;
      await this.containers.probeHttp(
        proxyName,
        config,
        'proxy',
        proxyHealthPath,
        config.health.timeoutSeconds,
      );
      if (!state.readyAt) {
        state.readyAt = now;
        state.failures = 0;
        await this.services()?.markDeploymentReady(config.id, new Date(now));
      } else if (config.status === 'unhealthy') {
        state.failures = 0;
        await this.services()?.setDeploymentHealth(config.id, 'healthy', undefined, new Date(now));
      } else state.failures = 0;
    } catch (error) {
      if (error instanceof ContainerOwnershipError) throw error;
      state.failures++;
      const detail = safeError(error);
      if (!state.readyAt && now - state.startedAt >= config.health.startupDeadlineSeconds * 1000) {
        await this.services()?.markDeploymentFailed(
          config.id,
          `Startup deadline exceeded: ${detail}`,
          new Date(now),
        );
        await this.logs
          .captureContainerLogs(config, 'origin', originName, this.appendLog)
          .catch(() => {});
        await this.logs
          .captureContainerLogs(config, 'proxy', proxyName, this.appendLog)
          .catch(() => {});
        await this.containers.stop(config);
      } else if (
        state.readyAt &&
        state.failures >= config.health.unhealthyThreshold &&
        config.status !== 'unhealthy'
      ) {
        await this.services()?.setDeploymentHealth(config.id, 'unhealthy', detail, new Date(now));
      }
    }
  }
}
