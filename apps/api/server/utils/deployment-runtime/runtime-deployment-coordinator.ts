import { DockerDeploymentContainers } from './containers';
import { RuntimeDeploymentLifecycle } from './runtime-lifecycle';
import { RuntimeLogCollector } from './log-collector';
import { containerName } from './preview-routes';
import type { RuntimeConfig, RuntimeServices } from './contracts';
import { safeError } from './runtime-errors';
import { ContainerOwnershipError } from './container-ownership';

type RuntimeDeploymentCoordinatorOptions = {
  containers: DockerDeploymentContainers;
  lifecycle: RuntimeDeploymentLifecycle;
  logs: RuntimeLogCollector;
  services: () => RuntimeServices | undefined;
  removing: Set<string>;
  instanceId: string;
  refreshRoutes: () => Promise<void>;
};

/** Coordinates per-deployment locks, reconciliation, log collection, and removal. */
export class RuntimeDeploymentCoordinator {
  readonly #inFlight = new Map<string, Promise<void>>();
  #collectingLogs = false;

  constructor(private readonly options: RuntimeDeploymentCoordinatorOptions) {}

  async reconcile(configs: RuntimeConfig[]): Promise<void> {
    await Promise.allSettled(
      configs.map((config) => this.#withLock(config.id, () => this.#reconcileOne(config))),
    );
  }

  async removeDeploymentResources(deploymentId: string, projectId: string): Promise<void> {
    const owner = { id: deploymentId, projectId };
    this.options.removing.add(deploymentId);
    try {
      const current = this.#inFlight.get(deploymentId);
      if (current) await current;
      while (this.#collectingLogs) await new Promise((resolve) => setTimeout(resolve, 10));
      await Promise.all(
        (['origin', 'proxy'] as const).map((role) =>
          this.options.containers.removeOwned(owner, role),
        ),
      );
      this.options.lifecycle.forget(deploymentId);
      await this.options.logs.forgetDeployment(deploymentId);
    } finally {
      this.options.removing.delete(deploymentId);
    }
  }

  async collectLogs(): Promise<void> {
    const services = this.options.services();
    if (!services || this.#collectingLogs) return;
    this.#collectingLogs = true;
    try {
      for (const config of services.listDeploymentRuntimeConfigs()) {
        if (this.options.removing.has(config.id)) continue;
        if (['deleted', 'cleaned'].includes(config.status)) continue;
        try {
          await this.options.logs.collectDeployment(config, this.#appendLog);
        } catch (error) {
          console.error(
            `[deployment-runtime] log collection failed for deployment ${config.id}`,
            error,
          );
          if (error instanceof ContainerOwnershipError)
            await this.#handleOwnershipConflict(config, error);
        }
      }
    } finally {
      this.#collectingLogs = false;
    }
  }

  async #reconcileOne(config: RuntimeConfig): Promise<void> {
    const { containers, lifecycle, services, removing, instanceId } = this.options;
    const current = services()?.getDeploymentRuntimeConfig(config.id);
    if (!current || removing.has(config.id)) return;
    config = current;
    if (config.status === 'failed' || config.desiredState === 'stopped') {
      await containers.stop(config);
      lifecycle.forget(config.id);
      return;
    }
    if (['deleted', 'cleaned'].includes(config.status)) return;
    const originName = containerName(instanceId, config.id, 'origin');
    const proxyName = containerName(instanceId, config.id, 'proxy');
    const [origin, proxy] = await Promise.all([
      containers.inspectContainer(originName),
      containers.inspectContainer(proxyName),
    ]);
    if (origin) containers.assertOwnedContainer(origin, config, 'origin');
    if (proxy) containers.assertOwnedContainer(proxy, config, 'proxy');
    if (!origin || !proxy || ['queued', 'starting'].includes(config.status)) {
      if (
        config.status !== 'queued' &&
        origin &&
        proxy &&
        origin.State.Running &&
        proxy.State.Running
      ) {
        // Keep a healthy runtime through an API process restart and continue probes.
      } else if (!(await lifecycle.start(config))) return;
    } else if (!origin.State.Running || !proxy.State.Running) {
      if (!(await lifecycle.start(config))) return;
    }
    const latest = services()?.getDeploymentRuntimeConfig(config.id);
    if (!latest || latest.desiredState !== 'running' || removing.has(config.id)) return;
    await lifecycle.probe(latest, originName, proxyName);
  }

  #appendLog = (deploymentId: string, source: 'origin' | 'proxy', content: string): void => {
    this.options.services()?.appendDeploymentLog(deploymentId, source, content);
  };

  async #withLock(id: string, task: () => Promise<void>): Promise<void> {
    const { removing, services } = this.options;
    if (removing.has(id)) return;
    const current = this.#inFlight.get(id);
    if (current) {
      await current;
      return;
    }
    if (removing.has(id)) return;
    const operation = (async () => {
      try {
        await task();
      } catch (error) {
        console.error(`[deployment-runtime] deployment ${id} reconciliation failed`, error);
        const currentConfig = services()?.getDeploymentRuntimeConfig(id);
        if (error instanceof ContainerOwnershipError && currentConfig) {
          await this.#handleOwnershipConflict(currentConfig, error);
          return;
        }
        if (currentConfig?.desiredState !== 'running') return;
        if (currentConfig.status === 'healthy' || currentConfig.status === 'unhealthy')
          await services()
            ?.setDeploymentHealth(id, 'unhealthy', safeError(error))
            .catch(() => {});
        else
          await services()
            ?.markDeploymentFailed(id, safeError(error))
            .catch(() => {});
      }
    })();
    this.#inFlight.set(id, operation);
    try {
      await operation;
    } finally {
      if (this.#inFlight.get(id) === operation) this.#inFlight.delete(id);
    }
  }

  async #handleOwnershipConflict(
    config: RuntimeConfig,
    error: ContainerOwnershipError,
  ): Promise<void> {
    const services = this.options.services();
    const current = services?.getDeploymentRuntimeConfig(config.id);
    if (!services || !current || current.projectId !== config.projectId) return;
    await services
      .markDeploymentFailed(config.id, safeError(error), undefined, { stopRuntime: true })
      .catch((failure) =>
        console.error(
          `[deployment-runtime] could not retire routes for deployment ${config.id}`,
          failure,
        ),
      );
    await this.options
      .refreshRoutes()
      .catch((failure) =>
        console.error(
          `[deployment-runtime] route retirement failed for deployment ${config.id}`,
          failure,
        ),
      );
  }
}
