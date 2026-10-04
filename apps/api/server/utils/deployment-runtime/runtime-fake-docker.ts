import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { DockerEngine, type DockerResponse } from '../docker-engine';

export class FakeDocker extends DockerEngine {
  readonly containers = new Map<
    string,
    { id: string; name: string; running: boolean; labels: Record<string, string> }
  >();
  readonly images = new Set<string>();
  readonly execs = new Map<string, number>();
  readonly requests: string[] = [];
  readonly logPayloads: Buffer[] = [];
  readonly streamPaths: string[] = [];
  networkReady = false;
  unavailable = false;
  failStop = false;
  probeStatuses: number[] = [];
  redirectProbe = false;
  createGate?: { entered: Promise<void>; release: () => void };
  #containerSequence = 0;
  #execSequence = 0;

  override async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<DockerResponse<T>> {
    this.requests.push(`${method} ${path}`);
    if (this.unavailable) throw new Error('Docker daemon is unavailable.');
    let value: unknown = {};
    if (path.startsWith('/networks?'))
      value = this.networkReady ? [{ Id: 'network-1', Name: 'senv-preview-test' }] : [];
    else if (path === '/networks/create') this.networkReady = true;
    else if (path === '/networks/network-1')
      value = { Id: 'network-1', Labels: { 'senv.instance': 'test' } };
    else if (path.startsWith('/images/create'))
      this.images.add(
        new URLSearchParams(path.split('?')[1]).get('fromImage') ?? 'nginx:1.27-alpine',
      );
    else if (path.startsWith('/images/')) {
      const image = decodeURIComponent(path.split('/')[2]!.replace(/\/json.*$/, ''));
      if (!this.images.has(image))
        throw new Error('Docker Engine GET image failed (404): not found');
      value = { RepoDigests: [`${image}@sha256:${'a'.repeat(64)}`] };
    } else if (path.startsWith('/containers/create?')) {
      if (this.createGate) {
        this.createGate.release = this.createGate.release.bind(this.createGate);
        await this.createGate.entered;
      }
      const name = new URLSearchParams(path.split('?')[1]).get('name')!;
      const config = body as { Labels: Record<string, string> };
      const id = `container-${++this.#containerSequence}`;
      this.containers.set(name, { id, name, running: false, labels: config.Labels });
      this.containers.set(id, this.containers.get(name)!);
      value = { Id: id };
    } else if (path.startsWith('/containers/') && path.endsWith('/json')) {
      const key = decodeURIComponent(path.slice('/containers/'.length, -'/json'.length));
      const container = this.containers.get(key);
      if (!container) throw new Error('Docker Engine GET container failed (404): not found');
      value = this.inspect(container);
    } else if (path.startsWith('/containers/') && path.endsWith('/start')) {
      const container = this.containerFromPath(path);
      container.running = true;
    } else if (path.startsWith('/containers/') && path.includes('/stop')) {
      if (this.failStop) throw new Error('Docker stop failed.');
      this.containerFromPath(path).running = false;
    } else if (path.startsWith('/containers/') && method === 'DELETE') {
      const container = this.containerFromPath(path);
      this.containers.delete(container.name);
      this.containers.delete(container.id);
    } else if (path.startsWith('/containers/json')) value = [];
    else if (path.startsWith('/containers/') && path.endsWith('/exec'))
      value = { Id: `exec-${++this.#execSequence}` };
    else if (path.startsWith('/exec/') && path.endsWith('/start')) {
      const code = this.probeStatuses.shift() ?? 200;
      this.execs.set(path.split('/')[2]!, code);
      const statusLines = this.redirectProbe
        ? `HTTP/1.1 302 Found\r\nLocation: https://elsewhere.test/\r\nHTTP/1.1 200 OK\r\n`
        : `HTTP/1.1 ${code} ${code === 200 ? 'OK' : 'Service Unavailable'}\r\n`;
      value = dockerFrame(statusLines);
    } else if (path.startsWith('/exec/') && path.endsWith('/json')) {
      const code = this.execs.get(path.split('/')[2]!) ?? 200;
      value = { ExitCode: code >= 200 && code < 400 ? 0 : 1 };
    }
    return { status: 200, headers: {}, body: value as T };
  }

  override async uploadFile(): Promise<void> {}
  override async stream(_method: string, path: string): Promise<IncomingMessage> {
    this.streamPaths.push(path);
    const payload = this.logPayloads.shift() ?? dockerFrame('');
    return Readable.from([
      payload.subarray(0, 2),
      payload.subarray(2),
    ]) as unknown as IncomingMessage;
  }

  async createContainerGate(): Promise<{ waitForEntry: Promise<void>; release: () => void }> {
    let entered!: () => void;
    let release!: () => void;
    const waitForEntry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.createGate = { entered: waitForEntry, release: entered };
    const original = this.request.bind(this);
    this.request = async <T = unknown>(method: string, path: string, body?: unknown) => {
      if (path.startsWith('/containers/create?') && this.createGate) {
        this.createGate.release();
        await released;
        this.createGate = undefined;
      }
      return original<T>(method, path, body);
    };
    return { waitForEntry, release };
  }

  private containerFromPath(path: string) {
    const key = decodeURIComponent(path.slice('/containers/'.length).split(/[/?]/)[0]!);
    const container = this.containers.get(key);
    if (!container) throw new Error(`container ${key} not found`);
    return container;
  }

  private inspect(container: {
    id: string;
    name: string;
    running: boolean;
    labels: Record<string, string>;
  }) {
    return {
      Id: container.id,
      State: {
        Running: container.running,
        Status: container.running ? 'running' : 'exited',
        ExitCode: 0,
      },
      Config: { Labels: container.labels, Image: 'nginx:1.27-alpine' },
    };
  }
}

export function dockerFrame(text: string): Buffer {
  return dockerFrameBytes(Buffer.from(text));
}

export function dockerFrameBytes(payload: Buffer): Buffer {
  const frame = Buffer.alloc(8 + payload.length);
  frame[0] = 1;
  frame.writeUInt32BE(payload.length, 4);
  payload.copy(frame, 8);
  return frame;
}
