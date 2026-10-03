import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { DockerEngine } from '../docker-engine';
import { createNginxConfig, type ProxySettings } from './nginx-config';
import { ArtifactStore } from './artifacts';
import { deploymentStorageRoot } from '../deployment-storage';
import { withArtifactStorageLock } from '../deployment-storage-lock';
import { PreviewRoutePublisher, containerName, type PreviewRouteTargets } from './preview-routes';
import { writeTarFromDirectory } from './tar';

export type RuntimeConfig = {
  id: string;
  projectId: string;
  kind: 'static' | 'container';
  artifactId: string | null;
  imageDigest?: string | null;
  port: number;
  env: Record<string, string>;
  secrets: Record<string, string>;
  registryAuth?: { serverAddress: string; username: string; password: string };
  health: {
    path: string;
    startupDeadlineSeconds: number;
    intervalSeconds: number;
    timeoutSeconds: number;
    unhealthyThreshold: number;
  };
  spaFallback: boolean;
  proxy: ProxySettings;
  limits: {
    origin: { cpus: string; memoryBytes: number };
    proxy: { cpus: string; memoryBytes: number };
  };
  logs?: { files: number; fileSizeBytes: number };
  desiredState: 'running' | 'stopped';
  status: string;
  submittedAt: Date;
};
type EngineContainer = {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
  Labels?: Record<string, string>;
};
type ContainerInspect = {
  Id: string;
  State: { Running: boolean; Status: string; ExitCode?: number };
  Config?: { Image?: string; Labels?: Record<string, string> };
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> };
};
export type RuntimeServices = typeof import('../deployments');

const DEFAULT_LOG_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOG_FILES = 3;
const MAX_LOG_FRAGMENT_CHARS = 8_000; // At most 32 KiB of UTF-8, even for four-byte code points.
const MAX_LOG_BATCH_BYTES = 32 * 1024;

export type RuntimeOptions = {
  engine?: DockerEngine;
  services?: RuntimeServices;
  root?: string;
  instanceId?: string;
  networkName?: string;
  previewConfigFile?: string;
  apiUrl?: string;
  entryPoints?: string[];
  tls?: boolean;
  certificateResolver?: string;
  staticOriginImage?: string;
  proxyImage?: string;
  pollIntervalMs?: number;
  logPollIntervalMs?: number;
};

/** Runs and reconciles only containers carrying this instance's ownership labels. */
export class DeploymentRuntime {
  readonly engine: DockerEngine;
  readonly root: string;
  readonly instanceId: string;
  readonly networkName: string;
  readonly artifacts: ArtifactStore;
  readonly routes: PreviewRoutePublisher;
  readonly staticOriginImage: string;
  readonly proxyImage: string;
  readonly #pollIntervalMs: number;
  readonly #logPollIntervalMs: number;
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #removing = new Set<string>();
  readonly #health = new Map<
    string,
    { startedAt: number; readyAt: number | null; failures: number; nextAt: number }
  >();
  readonly #logSince = new Map<string, number>();
  readonly #seenLogRows = new Map<string, Set<string>>();
  #services?: RuntimeServices;
  #timer?: NodeJS.Timeout;
  #logTimer?: NodeJS.Timeout;
  #reconciling = false;
  #collectingLogs = false;

  constructor(options: RuntimeOptions = {}) {
    this.#services = options.services;
    this.engine = options.engine ?? new DockerEngine();
    this.root = options.root ?? deploymentStorageRoot();
    this.instanceId =
      options.instanceId ??
      process.env['SENV_INSTANCE_ID'] ??
      `senv-${createHash('sha256').update(deploymentStorageRoot()).digest('hex').slice(0, 10)}`;
    this.networkName = options.networkName ?? `senv-preview-${this.instanceId}`;
    this.staticOriginImage =
      options.staticOriginImage ??
      process.env['DEPLOYMENT_STATIC_ORIGIN_IMAGE'] ??
      'nginx:1.27-alpine';
    this.proxyImage =
      options.proxyImage ?? process.env['DEPLOYMENT_PROXY_IMAGE'] ?? 'nginx:1.27-alpine';
    this.#pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.#logPollIntervalMs = options.logPollIntervalMs ?? 30_000;
    this.artifacts = new ArtifactStore({ root: this.root, maxBytes: uploadLimit() });
    this.routes = new PreviewRoutePublisher({
      configFile:
        options.previewConfigFile ??
        process.env['PREVIEW_DYNAMIC_CONFIG'] ??
        join(this.root, 'senv-routes.yml'),
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
    this.#services ??= await import('../deployments');
    this.#services.registerPreviewRoutesRefresh(() => this.refreshPreviewRoutes());
    this.#services.registerDeploymentRemovalHandler((id) => this.#removeDeploymentResources(id));
    await this.#services
      .resumePendingDeploymentRemovals()
      .catch((error) =>
        console.error(
          '[deployment-runtime] pending removal recovery failed; the service preserved the records for retry',
          error,
        ),
      );
    await this.#loadLogCursors();
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
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#logTimer) clearInterval(this.#logTimer);
  }

  async refreshPreviewRoutes(targets?: PreviewRouteTargets): Promise<void> {
    const value = targets ?? this.#services?.getPreviewRouteTargets();
    if (value) await this.routes.publish(value);
  }

  async reconcile(): Promise<void> {
    if (!this.#services || this.#reconciling) return;
    this.#reconciling = true;
    try {
      let networkError: unknown;
      try {
        await this.routes.ensureNetwork();
      } catch (error) {
        networkError = error;
      }
      await this.#services.cleanupDueDeployments();
      const configs = (this.#services.listDeploymentRuntimeConfigs() as RuntimeConfig[]).filter(
        Boolean,
      );
      await Promise.allSettled(
        configs.map((config) =>
          this.#withLock(config.id, () =>
            networkError ? Promise.reject(networkError) : this.#reconcileOne(config),
          ),
        ),
      );
      if (!networkError) {
        await this.#removeOrphanContainers(new Set(configs.map((config) => config.id)));
        await this.#removeUnreferencedArtifacts(configs);
      }
      await this.refreshPreviewRoutes();
    } finally {
      this.#reconciling = false;
    }
  }

  async #reconcileOne(config: RuntimeConfig): Promise<void> {
    const current = this.#services?.getDeploymentRuntimeConfig(config.id) as RuntimeConfig | null;
    if (!current || this.#removing.has(config.id)) return;
    config = current;
    if (config.desiredState === 'stopped') {
      await this.#stopContainers(config.id);
      this.#health.delete(config.id);
      return;
    }
    if (['deleted', 'cleaned', 'failed'].includes(config.status)) return;
    const originName = containerName(this.instanceId, config.id, 'origin');
    const proxyName = containerName(this.instanceId, config.id, 'proxy');
    const [origin, proxy] = await Promise.all([
      this.#inspectContainer(originName),
      this.#inspectContainer(proxyName),
    ]);
    if (!origin || !proxy || ['queued', 'starting'].includes(config.status)) {
      if (
        config.status !== 'queued' &&
        origin &&
        proxy &&
        origin.State.Running &&
        proxy.State.Running
      ) {
        // Keep a healthy runtime through an API process restart and continue probes.
      } else {
        if (!(await this.#start(config))) return;
      }
    } else if (!origin.State.Running || !proxy.State.Running) {
      if (!(await this.#start(config))) return;
    }
    const latest = this.#services?.getDeploymentRuntimeConfig(config.id) as RuntimeConfig | null;
    if (!latest || latest.desiredState !== 'running' || this.#removing.has(config.id)) return;
    await this.#probe(latest, originName, proxyName);
  }

  async #start(config: RuntimeConfig): Promise<RuntimeConfig | null> {
    const started = (await this.#services?.markDeploymentStarting(config.id)) as
      | RuntimeConfig
      | null
      | undefined;
    if (!started || started.desiredState !== 'running' || this.#removing.has(config.id))
      return null;
    config = started;
    const originName = containerName(this.instanceId, config.id, 'origin');
    const proxyName = containerName(this.instanceId, config.id, 'proxy');
    this.#health.set(config.id, {
      startedAt: Date.now(),
      readyAt: null,
      failures: 0,
      nextAt: Date.now(),
    });
    await this.#removeOwnedContainer(config.id, 'origin');
    await this.#removeOwnedContainer(config.id, 'proxy');
    const created: string[] = [];
    try {
      const originImage =
        config.kind === 'static' ? this.staticOriginImage : await this.#resolveImage(config);
      if (config.kind === 'static') await this.#ensureImage(originImage);
      await this.#ensureImage(this.proxyImage);
      const originId = await this.#createOrigin(config, originName, originImage);
      created.push(originId);
      if (config.kind === 'static') {
        if (!process.env['DEPLOYMENT_ARTIFACT_VOLUME'])
          await this.#installStaticArtifact(config, originId);
        await this.#installStaticOriginConfig(config, originId);
      }

      const proxyConfig = createNginxConfig({
        deploymentId: config.id,
        origin: `http://${originName}:${config.port}`,
        settings: config.proxy,
        spaFallback: config.spaFallback,
      });
      const proxyId = await this.#createProxy(config, proxyName);
      created.push(proxyId);
      await this.#installProxyConfig(proxyId, proxyConfig);
      await this.engine.request('POST', `/containers/${encodeURIComponent(originId)}/start`);
      await this.engine.request('POST', `/containers/${encodeURIComponent(proxyId)}/start`);
      const [originState, proxyState] = await Promise.all([
        this.#inspectId(originId),
        this.#inspectId(proxyId),
      ]);
      if (!originState?.State.Running || !proxyState?.State.Running)
        throw new Error('Origin or proxy container exited during startup.');
      const state = this.#health.get(config.id);
      if (state) state.nextAt = Date.now();
      return config;
    } catch (error) {
      await this.#captureContainerLogs(config.id, 'origin', created[0]).catch(() => {});
      await this.#captureContainerLogs(config.id, 'proxy', created[1]).catch(() => {});
      await Promise.allSettled(created.map((id) => this.#removeContainer(id)));
      await this.#services?.markDeploymentFailed(config.id, safeError(error));
      throw error;
    }
  }

  async #resolveImage(config: RuntimeConfig): Promise<string> {
    let image = config.imageDigest;
    if (!image) throw new Error('Deployment snapshot has no image reference.');
    if (image.includes('@sha256:')) {
      await this.#ensureImage(image, config.registryAuth);
    } else {
      await this.#pullImage(image, config.registryAuth);
      const inspected = await this.engine.request<{ RepoDigests?: string[] }>(
        'GET',
        `/images/${encodeURIComponent(image)}/json`,
      );
      const digest = inspected.body.RepoDigests?.find((item) => item.includes('@sha256:'));
      if (!digest)
        throw new Error(`Registry did not return an immutable digest for image ${image}.`);
      image = digest;
      await this.#services?.setDeploymentImageDigest(config.id, image);
    }
    return image;
  }

  async #ensureImage(image: string, auth?: RuntimeConfig['registryAuth']): Promise<void> {
    if (await this.#imageExists(image)) return;
    await this.#pullImage(image, auth);
    if (!(await this.#imageExists(image)))
      throw new Error(`Docker image ${image} was not available after pull.`);
  }

  async #imageExists(image: string): Promise<boolean> {
    try {
      await this.engine.request('GET', `/images/${encodeURIComponent(image)}/json`);
      return true;
    } catch (error) {
      if (String(error).includes('(404)')) return false;
      throw error;
    }
  }

  async #pullImage(image: string, auth?: RuntimeConfig['registryAuth']): Promise<void> {
    const headers: Record<string, string> = {};
    if (auth)
      headers['x-registry-auth'] = Buffer.from(
        JSON.stringify({
          serveraddress: auth.serverAddress,
          username: auth.username,
          password: auth.password,
        }),
      ).toString('base64');
    await this.engine.request(
      'POST',
      `/images/create?fromImage=${encodeURIComponent(image)}`,
      undefined,
      headers,
    );
  }

  async #createOrigin(config: RuntimeConfig, name: string, image: string): Promise<string> {
    const isStatic = config.kind === 'static';
    const env = Object.entries({ ...config.env, ...config.secrets }).map(
      ([key, value]) => `${key}=${value}`,
    );
    const created = await this.engine.request<{ Id: string }>(
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

  async #createProxy(config: RuntimeConfig, name: string): Promise<string> {
    const created = await this.engine.request<{ Id: string }>(
      'POST',
      `/containers/create?name=${encodeURIComponent(name)}`,
      {
        Image: this.proxyImage,
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
      'senv.instance': this.instanceId,
      'senv.deployment': config.id,
      'senv.role': role,
      'senv.project': config.projectId,
    };
  }

  #hostConfig(
    limits: { cpus: string; memoryBytes: number },
    config: RuntimeConfig,
  ): Record<string, unknown> {
    const fileSize = config.logs?.fileSizeBytes ?? DEFAULT_LOG_BYTES;
    const files = config.logs?.files ?? DEFAULT_LOG_FILES;
    return {
      NetworkMode: this.networkName,
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

  async #installStaticArtifact(config: RuntimeConfig, containerId: string): Promise<void> {
    if (!config.artifactId) throw new Error('Static deployment has no retained artifact.');
    const artifact = await this.#services?.getArtifact(config.artifactId);
    if (!artifact || artifact.kind !== 'static')
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

  async #installStaticOriginConfig(config: RuntimeConfig, containerId: string): Promise<void> {
    const artifact = config.artifactId
      ? await this.#services?.getArtifact(config.artifactId)
      : null;
    if (
      !artifact ||
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

  async #installProxyConfig(containerId: string, config: string): Promise<void> {
    const temp = await mkdtemp(join(this.root, 'tmp/proxy-config-'));
    try {
      const files = join(temp, 'files');
      await mkdir(files);
      await writeFile(join(files, 'nginx.conf'), config, { mode: 0o644 });
      const tarPath = join(temp, 'proxy.tar');
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

  async #probe(config: RuntimeConfig, originName: string, proxyName: string): Promise<void> {
    const current = this.#services?.getDeploymentRuntimeConfig(config.id) as RuntimeConfig | null;
    if (!current || current.desiredState !== 'running' || this.#removing.has(config.id)) return;
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
      await this.#probeHttp(
        proxyName,
        `http://${originName}:${config.port}${config.health.path}`,
        config.health.timeoutSeconds,
      );
      const proxyHealthPath = `http://127.0.0.1/_senv_health/${encodeURIComponent(config.id)}`;
      await this.#probeHttp(proxyName, proxyHealthPath, config.health.timeoutSeconds);
      if (!state.readyAt) {
        state.readyAt = now;
        state.failures = 0;
        await this.#services?.markDeploymentReady(config.id, new Date(now));
      } else if (config.status === 'unhealthy') {
        state.failures = 0;
        await this.#services?.setDeploymentHealth(config.id, 'healthy', undefined, new Date(now));
      } else state.failures = 0;
    } catch (error) {
      state.failures++;
      const detail = safeError(error);
      if (!state.readyAt && now - state.startedAt >= config.health.startupDeadlineSeconds * 1000) {
        await this.#services?.markDeploymentFailed(
          config.id,
          `Startup deadline exceeded: ${detail}`,
          new Date(now),
        );
        await this.#captureContainerLogs(config.id, 'origin', originName).catch(() => {});
        await this.#captureContainerLogs(config.id, 'proxy', proxyName).catch(() => {});
        await this.#stopContainers(config.id);
      } else if (
        state.readyAt &&
        state.failures >= config.health.unhealthyThreshold &&
        config.status !== 'unhealthy'
      ) {
        await this.#services?.setDeploymentHealth(config.id, 'unhealthy', detail, new Date(now));
      }
    }
  }

  async #probeHttp(containerNameValue: string, url: string, timeoutSeconds: number): Promise<void> {
    const container = await this.#inspectContainer(containerNameValue);
    if (!container?.State.Running) throw new Error(`${containerNameValue} is not running.`);
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

  async #stopContainers(deploymentId: string): Promise<void> {
    await Promise.all(
      [
        containerName(this.instanceId, deploymentId, 'origin'),
        containerName(this.instanceId, deploymentId, 'proxy'),
      ].map(async (name) => {
        const container = await this.#inspectContainer(name);
        if (container)
          this.#assertOwnedContainer(
            container,
            deploymentId,
            name.endsWith('-proxy') ? 'proxy' : 'origin',
          );
        if (container?.State.Running)
          await this.engine
            .request('POST', `/containers/${encodeURIComponent(container.Id)}/stop?t=5`)
            .catch(() => {});
      }),
    );
  }

  async #removeDeploymentResources(deploymentId: string): Promise<void> {
    this.#removing.add(deploymentId);
    try {
      const current = this.#inFlight.get(deploymentId);
      if (current) await current;
      while (this.#collectingLogs) await new Promise((resolve) => setTimeout(resolve, 10));
      await Promise.all(
        (['origin', 'proxy'] as const).map(async (role) => {
          const name = containerName(this.instanceId, deploymentId, role);
          const container = await this.#inspectContainer(name);
          if (!container) return;
          this.#assertOwnedContainer(container, deploymentId, role);
          await this.engine.request(
            'DELETE',
            `/containers/${encodeURIComponent(container.Id)}?force=true&v=false`,
          );
        }),
      );
      this.#health.delete(deploymentId);
      this.#logSince.delete(`${deploymentId}:origin`);
      this.#logSince.delete(`${deploymentId}:proxy`);
      this.#seenLogRows.delete(`${deploymentId}:origin`);
      this.#seenLogRows.delete(`${deploymentId}:proxy`);
      await this.#saveLogCursors();
    } finally {
      this.#removing.delete(deploymentId);
    }
  }

  async #inspectContainer(name: string): Promise<ContainerInspect | null> {
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
  async #inspectId(id: string): Promise<ContainerInspect | null> {
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
  async #removeContainer(idOrName: string): Promise<void> {
    const container = await this.#inspectContainer(idOrName).catch(() => null);
    const id = container?.Id ?? idOrName;
    await this.engine
      .request('DELETE', `/containers/${encodeURIComponent(id)}?force=true&v=false`)
      .catch(() => {});
  }

  async #removeOwnedContainer(deploymentId: string, role: 'origin' | 'proxy'): Promise<void> {
    const container = await this.#inspectContainer(
      containerName(this.instanceId, deploymentId, role),
    );
    if (!container) return;
    this.#assertOwnedContainer(container, deploymentId, role);
    await this.engine.request(
      'DELETE',
      `/containers/${encodeURIComponent(container.Id)}?force=true&v=false`,
    );
  }

  #assertOwnedContainer(
    container: ContainerInspect,
    deploymentId: string,
    role: 'origin' | 'proxy',
  ): void {
    const labels = container.Config?.Labels;
    if (
      labels?.['senv.managed'] !== 'true' ||
      labels['senv.instance'] !== this.instanceId ||
      labels['senv.deployment'] !== deploymentId ||
      labels['senv.role'] !== role
    ) {
      throw new Error(
        `Refusing to manage container ${container.Id} because its ownership labels do not match this deployment.`,
      );
    }
  }

  async #removeOrphanContainers(activeIds: Set<string>): Promise<void> {
    const containers = await this.engine.request<EngineContainer[]>(
      'GET',
      `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`senv.managed=true`, `senv.instance=${this.instanceId}`] }))}`,
    );
    for (const container of containers.body) {
      const id = container.Labels?.['senv.deployment'];
      if (!id || activeIds.has(id)) continue;
      const role = container.Labels?.['senv.role'];
      if (role !== 'origin' && role !== 'proxy') continue;
      const inspected = await this.#inspectId(container.Id);
      if (!inspected) continue;
      this.#assertOwnedContainer(inspected, id, role);
      await this.engine
        .request('DELETE', `/containers/${encodeURIComponent(container.Id)}?force=true&v=false`)
        .catch(() => {});
    }
  }

  async #removeUnreferencedArtifacts(configs: RuntimeConfig[]): Promise<void> {
    await withArtifactStorageLock(this.root, async () => {
      const cleanupState = await this.#services?.getArtifactCleanupState();
      const keep = new Set<string>(
        cleanupState?.referenced ??
          configs.map((config) => config.artifactId).filter((id): id is string => Boolean(id)),
      );
      const pending = new Set(cleanupState?.pending ?? []);
      const released = new Set(cleanupState?.released ?? []);
      const artifactRoot = join(this.root, 'artifacts');
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
          await this.artifacts.remove(entry.name);
          await this.#services?.forgetArtifactStorageKey?.(entry.name);
        }
      }
    });
    const tempRoot = join(this.root, 'tmp');
    const temps = await readdir(tempRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of temps) {
      if (!entry.isDirectory()) continue;
      const path = join(tempRoot, entry.name);
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < Date.now() - 60 * 60 * 1000)
        await rm(path, { recursive: true, force: true });
    }
  }

  async collectLogs(): Promise<void> {
    if (!this.#services || this.#collectingLogs) return;
    this.#collectingLogs = true;
    try {
      const configs = this.#services.listDeploymentRuntimeConfigs() as RuntimeConfig[];
      for (const config of configs) {
        if (this.#removing.has(config.id)) continue;
        if (['deleted', 'cleaned'].includes(config.status)) continue;
        for (const role of ['origin', 'proxy'] as const) {
          const container = await this.#inspectContainer(
            containerName(this.instanceId, config.id, role),
          );
          if (!container) continue;
          const key = `${config.id}:${role}`;
          const since = this.#logSince.get(key);
          const query = since === undefined ? 'tail=all' : `since=${Math.max(0, since)}`;
          const response = await this.engine
            .stream(
              'GET',
              `/containers/${encodeURIComponent(container.Id)}/logs?stdout=1&stderr=1&timestamps=1&${query}`,
            )
            .catch(() => null);
          if (!response) continue;
          const seen = this.#seenLogRows.get(key) ?? new Set<string>();
          let latest = since ?? 0;
          let pending = '';
          let fragmentIndex = 0;
          let batch: string[] = [];
          let batchBytes = 0;
          const append = () => {
            if (batch.length) this.#services?.appendDeploymentLog(config.id, role, batch.join(''));
            batch = [];
            batchBytes = 0;
          };
          const consumeLine = (line: string, ending = '', fragment = 0) => {
            if (!line) return;
            const timestamp = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)/)?.[1];
            const unix = timestamp ? Date.parse(timestamp) / 1000 : 0;
            const fingerprint = createHash('sha256')
              .update(String(fragment))
              .update('\0')
              .update(line)
              .digest('hex');
            if (seen.has(fingerprint)) return;
            seen.add(fingerprint);
            if (seen.size > 50_000) seen.delete(seen.values().next().value!);
            let offset = 0;
            for (const part of utf8Fragments(line)) {
              batch.push(part);
              batchBytes += Buffer.byteLength(part);
              offset += part.length;
              if (batchBytes >= MAX_LOG_BATCH_BYTES) append();
            }
            if (ending) {
              batch.push(ending);
              batchBytes += Buffer.byteLength(ending);
            }
            latest = Math.max(latest, unix);
          };
          for await (const chunk of dockerStreamTextChunks(response)) {
            pending += chunk;
            while (pending) {
              const newline = pending.indexOf('\n');
              if (newline >= 0 && newline < MAX_LOG_FRAGMENT_CHARS) {
                const hasCarriageReturn = newline > 0 && pending[newline - 1] === '\r';
                const line = pending.slice(0, hasCarriageReturn ? newline - 1 : newline);
                consumeLine(line, hasCarriageReturn ? '\r\n' : '\n', fragmentIndex);
                fragmentIndex = 0;
                pending = pending.slice(newline + 1);
              } else if (
                pending.length >= MAX_LOG_FRAGMENT_CHARS ||
                (newline >= 0 && newline >= MAX_LOG_FRAGMENT_CHARS)
              ) {
                const fragment = takeUtf8Prefix(pending, MAX_LOG_FRAGMENT_CHARS);
                consumeLine(fragment, '', fragmentIndex++);
                pending = pending.slice(fragment.length);
              } else break;
            }
          }
          consumeLine(pending, '', fragmentIndex);
          append();
          this.#seenLogRows.set(key, seen);
          if (latest > (since ?? 0)) {
            this.#logSince.set(key, latest);
            await this.#saveLogCursors();
          }
        }
      }
    } finally {
      this.#collectingLogs = false;
    }
  }

  async #captureContainerLogs(
    deploymentId: string,
    source: 'origin' | 'proxy',
    id?: string,
  ): Promise<void> {
    if (!id || !this.#services) return;
    const response = await this.engine
      .stream(
        'GET',
        `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&timestamps=1&tail=all`,
      )
      .catch(() => null);
    if (!response) return;
    let pending = '';
    let batch: string[] = [];
    let bytes = 0;
    const append = () => {
      if (batch.length) this.#services?.appendDeploymentLog(deploymentId, source, batch.join(''));
      batch = [];
      bytes = 0;
    };
    const consumeLine = (line: string, ending = '') => {
      if (!line) return;
      for (const part of utf8Fragments(line)) {
        batch.push(part);
        bytes += Buffer.byteLength(part);
        if (bytes >= MAX_LOG_BATCH_BYTES) append();
      }
      if (ending) {
        batch.push(ending);
        bytes += Buffer.byteLength(ending);
      }
    };
    for await (const chunk of dockerStreamTextChunks(response)) {
      pending += chunk;
      while (pending) {
        const newline = pending.indexOf('\n');
        if (newline >= 0 && newline < MAX_LOG_FRAGMENT_CHARS) {
          const hasCarriageReturn = newline > 0 && pending[newline - 1] === '\r';
          const line = pending.slice(0, hasCarriageReturn ? newline - 1 : newline);
          consumeLine(line, hasCarriageReturn ? '\r\n' : '\n');
          pending = pending.slice(newline + 1);
        } else if (
          pending.length >= MAX_LOG_FRAGMENT_CHARS ||
          (newline >= 0 && newline >= MAX_LOG_FRAGMENT_CHARS)
        ) {
          const fragment = takeUtf8Prefix(pending, MAX_LOG_FRAGMENT_CHARS);
          consumeLine(fragment);
          pending = pending.slice(fragment.length);
        } else break;
      }
    }
    consumeLine(pending);
    append();
  }

  async #loadLogCursors(): Promise<void> {
    const path = join(this.root, 'log-cursors.json');
    const content = await readFile(path, 'utf8').catch(() => null);
    if (!content) return;
    try {
      const parsed = JSON.parse(content) as Record<string, number>;
      for (const [key, value] of Object.entries(parsed))
        if (Number.isFinite(value) && value > 0) this.#logSince.set(key, value);
    } catch {
      console.warn('[deployment-runtime] ignoring invalid persisted log cursor file');
    }
  }

  async #saveLogCursors(): Promise<void> {
    const path = join(this.root, 'log-cursors.json');
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(Object.fromEntries(this.#logSince)), { mode: 0o600 });
    await rename(temp, path);
  }

  async #withLock(id: string, task: () => Promise<void>): Promise<void> {
    if (this.#removing.has(id)) return;
    const current = this.#inFlight.get(id);
    if (current) {
      await current;
      return;
    }
    if (this.#removing.has(id)) return;
    const operation = (async () => {
      try {
        await task();
      } catch (error) {
        console.error(`[deployment-runtime] deployment ${id} reconciliation failed`, error);
        const config = this.#services?.getDeploymentRuntimeConfig(id) as RuntimeConfig | null;
        if (config?.desiredState === 'running') {
          if (config.status === 'healthy' || config.status === 'unhealthy')
            await this.#services
              ?.setDeploymentHealth(id, 'unhealthy', safeError(error))
              .catch(() => {});
          else await this.#services?.markDeploymentFailed(id, safeError(error)).catch(() => {});
        }
      }
    })();
    this.#inFlight.set(id, operation);
    try {
      await operation;
    } finally {
      if (this.#inFlight.get(id) === operation) this.#inFlight.delete(id);
    }
  }
}

function uploadLimit(): number {
  const configured = Number(process.env['DEPLOYMENT_UPLOAD_LIMIT_BYTES']);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 100 * 1024 * 1024;
}
export { deploymentStorageRoot } from '../deployment-storage';
export function createStaticOriginNginxConfig(port: number, root: string): string {
  return `server { listen ${port}; server_tokens off; root ${root}; index index.html; location / { try_files $uri $uri/ =404; } }\n`;
}
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4000).replace(/(password|token|secret)([=: ]+)\S+/gi, '$1$2[redacted]');
}
function dockerStreamText(buffer: Buffer): string {
  // Docker's non-TTY stream multiplexing uses an 8-byte header per stdout/stderr frame.
  let offset = 0;
  const chunks: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const stream = buffer[offset];
    const length = buffer.readUInt32BE(offset + 4);
    if (length > buffer.length - offset - 8 || ![0, 1, 2].includes(stream ?? -1)) break;
    chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return (chunks.length ? Buffer.concat(chunks) : buffer).toString('utf8');
}

async function* dockerStreamTextChunks(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  let multiplexed: boolean | undefined;
  const rawDecoder = new StringDecoder('utf8');
  const frameDecoders = new Map<number, StringDecoder>();
  for await (const raw of stream) {
    pending = Buffer.concat([pending, Buffer.from(raw)]);
    if (multiplexed === undefined && pending.length >= 8) {
      multiplexed =
        [0, 1, 2].includes(pending[0] ?? -1) &&
        pending[1] === 0 &&
        pending[2] === 0 &&
        pending[3] === 0;
      if (!multiplexed) {
        yield* decodeDockerTextChunks(rawDecoder, pending);
        pending = Buffer.alloc(0);
      }
    }
    if (multiplexed === undefined) continue;
    if (!multiplexed) {
      if (pending.length) {
        yield* decodeDockerTextChunks(rawDecoder, pending);
        pending = Buffer.alloc(0);
      }
      continue;
    }
    while (pending.length >= 8) {
      const size = pending.readUInt32BE(4);
      if (size > 128 * 1024 * 1024) throw new Error('Docker log frame is too large.');
      if (pending.length < 8 + size) break;
      const channel = pending[0] ?? 1;
      let decoder = frameDecoders.get(channel);
      if (!decoder) {
        decoder = new StringDecoder('utf8');
        frameDecoders.set(channel, decoder);
      }
      yield* decodeDockerTextChunks(decoder, pending.subarray(8, 8 + size));
      pending = pending.subarray(8 + size);
    }
  }
  if (pending.length) {
    if (multiplexed) throw new Error('Docker log stream ended inside a multiplex frame.');
    yield* decodeDockerTextChunks(rawDecoder, pending);
  }
  for (const decoder of multiplexed ? frameDecoders.values() : [rawDecoder]) {
    const final = decoder.end();
    if (final) yield final;
  }
}

function* decodeDockerTextChunks(decoder: StringDecoder, buffer: Buffer): Generator<string> {
  const decoderChunkBytes = 32 * 1024;
  for (let offset = 0; offset < buffer.length; offset += decoderChunkBytes) {
    const decoded = decoder.write(
      buffer.subarray(offset, Math.min(buffer.length, offset + decoderChunkBytes)),
    );
    if (decoded) yield decoded;
  }
}

function* utf8Fragments(value: string): Generator<string> {
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + MAX_LOG_FRAGMENT_CHARS);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1] ?? '')) end--;
    yield value.slice(offset, end);
    offset = end;
  }
}

function takeUtf8Prefix(value: string, maxCodePoints: number): string {
  let end = Math.min(value.length, maxCodePoints);
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1] ?? '')) end--;
  return value.slice(0, end);
}
