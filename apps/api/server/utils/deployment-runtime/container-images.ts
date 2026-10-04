import { DockerEngine } from '../docker-engine';
import type { RuntimeConfig, RuntimeServices } from './contracts';

/** Resolves immutable deployment images and handles registry authentication. */
export class DockerContainerImages {
  constructor(
    private readonly engine: DockerEngine,
    private readonly services: () => RuntimeServices | undefined,
  ) {}

  async resolve(config: RuntimeConfig): Promise<string> {
    let image = config.imageDigest;
    if (!image) throw new Error('Deployment snapshot has no image reference.');
    if (image.includes('@sha256:')) {
      await this.ensure(image, config.registryAuth);
    } else {
      await this.#pull(image, config.registryAuth);
      const inspected = await this.engine.request<{ RepoDigests?: string[] }>(
        'GET',
        `/images/${encodeURIComponent(image)}/json`,
      );
      const digest = inspected.body.RepoDigests?.find((item) => item.includes('@sha256:'));
      if (!digest)
        throw new Error(`Registry did not return an immutable digest for image ${image}.`);
      image = digest;
      await this.services()?.setDeploymentImageDigest(config.id, image);
    }
    return image;
  }

  async ensure(image: string, auth?: RuntimeConfig['registryAuth']): Promise<void> {
    if (await this.#exists(image)) return;
    await this.#pull(image, auth);
    if (!(await this.#exists(image)))
      throw new Error(`Docker image ${image} was not available after pull.`);
  }

  async #exists(image: string): Promise<boolean> {
    try {
      await this.engine.request('GET', `/images/${encodeURIComponent(image)}/json`);
      return true;
    } catch (error) {
      if (String(error).includes('(404)')) return false;
      throw error;
    }
  }

  async #pull(image: string, auth?: RuntimeConfig['registryAuth']): Promise<void> {
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
}
