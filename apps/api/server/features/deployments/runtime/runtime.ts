import { RESOURCE_SAMPLE_INTERVAL_MS } from '../../../../shared/deployment-resources';
import { RuntimeResourceCollector } from './resource-collector';
import { join } from 'node:path';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import { deploymentStorageRoot } from '../storage/storage';
import { ArtifactStore } from './artifacts';
import { DockerDeploymentContainers } from './containers';
import { deploymentInstanceId } from './identity';
import { RuntimeLogCollector } from './log-collector';
import { PreviewRoutePublisher, type PreviewRouteTargets } from './preview-routes';
import { RuntimeCleanup } from './runtime-cleanup';
import { RuntimeDeploymentCoordinator } from './runtime-deployment-coordinator';
import { RuntimeDeploymentLifecycle } from './runtime-lifecycle';
import type { RuntimeOptions } from './runtime-options';
import {
  recoverPendingDeploymentRemovals,
  retryDeploymentRemovals,
} from './runtime-removal-maintenance';
import { deploymentUploadLimit } from './upload-limits';
export { createStaticOriginNginxConfig } from './containers';
export type { RuntimeConfig, RuntimeServices } from './contracts';
export type { RuntimeOptions } from './runtime-options';

import type { RuntimeServices } from './contracts';

export class DeploymentRuntime {
  readonly engine: DockerEngine;
  readonly root: string;
  readonly instanceId: string;
  readonly networkName: string;
  readonly artifacts: ArtifactStore;
  readonly routes: PreviewRoutePublisher;
  readonly #containers: DockerDeploymentContainers;
  readonly #logCollector: RuntimeLogCollector;
  readonly #lifecycle: RuntimeDeploymentLifecycle;
  readonly #cleanup: RuntimeCleanup;
  readonly #coordinator: RuntimeDeploymentCoordinator;
  readonly staticOriginImage: string;
  readonly proxyImage: string;
  readonly #pollIntervalMs: number;
  readonly #logPollIntervalMs: number;
  readonly #removing = new Set<string>();
  #services?: RuntimeServices;
  #timer?: NodeJS.Timeout;
  #logTimer?: NodeJS.Timeout;
  #resourceTimer?: NodeJS.Timeout;
  readonly #resourceCollector: RuntimeResourceCollector;
  #reconciling = false;

  constructor(options: RuntimeOptions = {}) {
    this.#services = options.services;
    this.engine = options.engine ?? new DockerEngine();
    this.root = options.root ?? deploymentStorageRoot();
    this.instanceId = options.instanceId ?? deploymentInstanceId(this.root);
    this.networkName = options.networkName ?? `senv-preview-${this.instanceId}`;
    this.staticOriginImage =
      options.staticOriginImage ??
      process.env['DEPLOYMENT_STATIC_ORIGIN_IMAGE'] ??
      'nginx:1.27-alpine';
    this.proxyImage =
      options.proxyImage ?? process.env['DEPLOYMENT_PROXY_IMAGE'] ?? 'nginx:1.27-alpine';
    this.#resourceCollector = new RuntimeResourceCollector({
      engine: this.engine,
      instanceId: this.instanceId,
      services: () => this.#services,
    });
    this.#logCollector = new RuntimeLogCollector({
      engine: this.engine,
      root: this.root,
      instanceId: this.instanceId,
    });
    this.#pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.#logPollIntervalMs = options.logPollIntervalMs ?? 30_000;
    this.artifacts = new ArtifactStore({ root: this.root, maxBytes: deploymentUploadLimit() });
    this.#containers = new DockerDeploymentContainers({
      engine: this.engine,
      instanceId: this.instanceId,
      networkName: this.networkName,
      root: this.root,
      proxyImage: this.proxyImage,
      artifacts: this.artifacts,
      services: () => this.#services,
    });
    this.#lifecycle = new RuntimeDeploymentLifecycle({
      engine: this.engine,
      containers: this.#containers,
      logs: this.#logCollector,
      services: () => this.#services,
      removing: this.#removing,
      instanceId: this.instanceId,
      staticOriginImage: this.staticOriginImage,
      proxyImage: this.proxyImage,
      appendLog: (deploymentId, source, content) =>
        this.#services?.appendDeploymentLog(deploymentId, source, content),
    });
    this.#cleanup = new RuntimeCleanup({
      engine: this.engine,
      containers: this.#containers,
      artifacts: this.artifacts,
      root: this.root,
      instanceId: this.instanceId,
      services: () => this.#services,
    });
    this.#coordinator = new RuntimeDeploymentCoordinator({
      containers: this.#containers,
      lifecycle: this.#lifecycle,
      logs: this.#logCollector,
      services: () => this.#services,
      removing: this.#removing,
      instanceId: this.instanceId,
      refreshRoutes: () => this.refreshPreviewRoutes(),
    });
    this.routes = new PreviewRoutePublisher({
      configFile:
        options.previewConfigFile ??
        process.env['PREVIEW_DYNAMIC_CONFIG'] ??
        join(this.root, 'routes', 'senv-routes.yml'),
      instanceId: this.instanceId,
      entryPoints:
        options.entryPoints ??
        (
          process.env['PREVIEW_ENTRYPOINTS'] ??
          (process.env['PREVIEW_TLS'] === 'false' ? 'web' : 'websecure')
        )
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      tls: options.tls ?? process.env['PREVIEW_TLS'] !== 'false',
      certificateResolver: options.certificateResolver ?? process.env['PREVIEW_TLS_RESOLVER'],
      apiUrl: options.apiUrl ?? process.env['PREVIEW_TRAEFIK_API_URL'],
      engine: this.engine,
      networkName: this.networkName,
    });
  }

  async start(): Promise<void> {
    await this.artifacts.initialize();
    this.#services ??= await import('../index');
    this.#services.registerPreviewRoutesRefresh(() => this.refreshPreviewRoutes());
    this.#services.registerDeploymentRemovalHandler((id, projectId) =>
      this.#coordinator.removeDeploymentResources(id, projectId),
    );
    await recoverPendingDeploymentRemovals(this.#services, this.#logCollector);
    this.#timer = setInterval(
      () =>
        void this.reconcile().catch((error) =>
          console.error('[deployment-runtime] reconcile failed', error),
        ),
      this.#pollIntervalMs,
    );
    this.#timer.unref();
    this.#logTimer = setInterval(
      () =>
        void this.collectLogs().catch((error) =>
          console.error('[deployment-runtime] log collection failed', error),
        ),
      this.#logPollIntervalMs,
    );
    this.#logTimer.unref();
    this.#resourceTimer = setInterval(
      () =>
        void this.collectResourceSamples().catch((error) =>
          console.error('[deployment-runtime] resource sampling failed', error),
        ),
      RESOURCE_SAMPLE_INTERVAL_MS,
    );
    this.#resourceTimer.unref();
    try {
      await this.refreshPreviewRoutes();
    } catch (error) {
      console.error(
        '[deployment-runtime] initial preview route refresh failed; scheduled reconciliation will retry',
        error,
      );
    }
    await this.reconcile().catch((error) =>
      console.error(
        '[deployment-runtime] initial reconciliation failed; scheduled reconciliation will retry',
        error,
      ),
    );
    await this.collectResourceSamples().catch((error) =>
      console.error('[deployment-runtime] initial resource sampling failed', error),
    );
  }

  collectResourceSamples(): Promise<void> {
    return this.#resourceCollector.collect();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#logTimer) clearInterval(this.#logTimer);
    if (this.#resourceTimer) clearInterval(this.#resourceTimer);
  }

  async refreshPreviewRoutes(targets?: PreviewRouteTargets): Promise<void> {
    const value = targets ?? this.#services?.getPreviewRouteTargets();
    if (value) await this.routes.publish(value);
  }

  async reconcile(): Promise<void> {
    if (!this.#services || this.#reconciling) return;
    this.#reconciling = true;
    try {
      // A host outage is retryable infrastructure failure, not a failed publication.
      await this.routes.ensureNetwork();
      await retryDeploymentRemovals(this.#services);
      const configs = this.#services.listDeploymentRuntimeConfigs();
      await this.#coordinator.reconcile(configs);
      await this.#cleanup.removeOrphanContainers(new Set(configs.map((config) => config.id)));
      await this.#cleanup.removeUnreferencedArtifacts(configs);
      await this.refreshPreviewRoutes();
    } finally {
      this.#reconciling = false;
    }
  }

  collectLogs(): Promise<void> {
    return this.#coordinator.collectLogs();
  }
}
