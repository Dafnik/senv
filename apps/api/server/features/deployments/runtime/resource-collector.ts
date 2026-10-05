import type { DockerEngine } from '../../../infrastructure/docker-engine';
import type { RuntimeServices } from './contracts';
import { readOriginResourceSample } from './origin-resources';

/** Samples every active origin independently of open browser sessions. */
export class RuntimeResourceCollector {
  #collecting = false;
  constructor(
    private readonly options: {
      engine: DockerEngine;
      instanceId: string;
      services: () => RuntimeServices | undefined;
    },
  ) {}

  async collect(): Promise<void> {
    const services = this.options.services();
    if (!services || this.#collecting) return;
    this.#collecting = true;
    try {
      services.pruneDeploymentResourceSamples();
      const configs = services.listDeploymentRuntimeConfigs()[Symbol.iterator]();
      // Bound Docker request concurrency across large projects.
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (const config of configs) {
            try {
              const sample = await readOriginResourceSample({
                engine: this.options.engine,
                instanceId: this.options.instanceId,
                projectId: config.projectId,
                deploymentId: config.id,
              });
              services.recordDeploymentResourceSample(config.id, sample);
            } catch (error) {
              console.error(
                `[deployment-runtime] resource sampling failed for ${config.id}`,
                error,
              );
            }
          }
        }),
      );
    } finally {
      this.#collecting = false;
    }
  }
}
