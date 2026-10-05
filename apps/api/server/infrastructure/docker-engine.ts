import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Duplex } from 'node:stream';

export type DockerResponse<T> = { status: number; headers: IncomingMessage['headers']; body: T };
export type DockerEngineOptions = { socketPath?: string; apiVersion?: string; timeoutMs?: number };

/** Small Docker Engine HTTP client. It deliberately uses the daemon's Unix socket, never the CLI. */
export class DockerEngine {
  readonly #socketPath: string;
  readonly #apiVersion: string;
  readonly #timeoutMs: number;

  constructor(options: DockerEngineOptions = {}) {
    this.#socketPath = options.socketPath ?? process.env['DOCKER_SOCKET'] ?? '/var/run/docker.sock';
    this.#apiVersion = options.apiVersion ?? process.env['DOCKER_API_VERSION'] ?? 'v1.45';
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<DockerResponse<T>> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const response = await this.#send(method, path, payload, {
      accept: 'application/json',
      ...(payload
        ? { 'content-type': 'application/json', 'content-length': String(payload.byteLength) }
        : {}),
      ...headers,
    });
    const bytes = await collect(response, 32 * 1024 * 1024);
    const text = bytes.toString('utf8');
    let parsed: unknown = text;
    if (path.includes('/logs') || (path.includes('/exec/') && path.endsWith('/start')))
      parsed = bytes;
    else if (text && response.headers['content-type']?.includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* preserve daemon's response for error reporting */
      }
    }
    if (response.statusCode && response.statusCode >= 400) {
      const message =
        typeof parsed === 'object' && parsed !== null && 'message' in parsed
          ? String(parsed.message)
          : text;
      throw new Error(
        `Docker Engine ${method} ${path} failed (${response.statusCode}): ${message}`,
      );
    }
    if (path.startsWith('/images/create')) {
      const failure = text
        .split('\n')
        .map((line) => {
          try {
            return JSON.parse(line) as { error?: string; errorDetail?: { message?: string } };
          } catch {
            return null;
          }
        })
        .find((line) => line?.error || line?.errorDetail?.message);
      if (failure)
        throw new Error(
          `Docker image pull failed: ${failure.errorDetail?.message ?? failure.error}`,
        );
    }
    return { status: response.statusCode ?? 0, headers: response.headers, body: parsed as T };
  }

  async stream(
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<IncomingMessage> {
    const response = await this.#send(method, path, undefined, headers);
    if ((response.statusCode ?? 500) >= 400) {
      const body = (await collect(response, 1024 * 1024)).toString('utf8');
      throw new Error(`Docker Engine ${method} ${path} failed (${response.statusCode}): ${body}`);
    }
    return response;
  }

  async attachExec(execId: string): Promise<Duplex> {
    const payload = Buffer.from(JSON.stringify({ Detach: false, Tty: true }));
    const req = this.#request('POST', `/exec/${encodeURIComponent(execId)}/start`, {
      'content-type': 'application/json',
      'content-length': String(payload.length),
      connection: 'Upgrade',
      upgrade: 'tcp',
    });
    return new Promise((resolve, reject) => {
      req.setTimeout(this.#timeoutMs, () =>
        req.destroy(new Error('Docker exec attach timed out.')),
      );
      req.once('error', reject);
      req.once('upgrade', (_response, socket, head) => {
        req.setTimeout(0);
        socket.setTimeout(0);
        if (head.length) socket.unshift(head);
        resolve(socket);
      });
      req.once('response', (response) => {
        req.setTimeout(0);
        if (response.statusCode !== 200 || !response.socket) {
          response.resume();
          reject(new Error(`Docker exec attach failed (${response.statusCode}).`));
          return;
        }
        response.socket.setTimeout(0);
        resolve(Duplex.from({ readable: response, writable: response.socket }));
      });
      req.end(payload);
    });
  }

  async uploadFile(
    method: string,
    path: string,
    filename: string,
    contentType = 'application/x-tar',
    extraHeaders: Record<string, string> = {},
  ): Promise<void> {
    const fileStat = await stat(filename);
    const req = this.#request(method, path, {
      'content-type': contentType,
      'content-length': String(fileStat.size),
      ...extraHeaders,
    });
    const responsePromise = new Promise<IncomingMessage>((resolve, reject) => {
      req.once('response', resolve);
      req.once('error', reject);
    });
    const timeoutMs = pathTimeout(path, this.#timeoutMs);
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`Docker Engine request timed out after ${timeoutMs}ms`)),
    );
    const [, response] = await Promise.all([
      pipeline(createReadStream(filename), req),
      responsePromise,
    ]);
    const body = (await collect(response, 1024 * 1024)).toString('utf8');
    if ((response.statusCode ?? 500) >= 400)
      throw new Error(`Docker Engine ${method} ${path} failed (${response.statusCode}): ${body}`);
  }

  #send(
    method: string,
    path: string,
    body: Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<IncomingMessage> {
    const req = this.#request(method, path, {
      ...headers,
      ...(body ? { 'content-length': String(body.byteLength) } : {}),
    });
    return new Promise((resolve, reject) => {
      req.once('response', resolve);
      req.once('error', reject);
      const timeoutMs = pathTimeout(path, this.#timeoutMs);
      req.setTimeout(timeoutMs, () =>
        req.destroy(new Error(`Docker Engine request timed out after ${timeoutMs}ms`)),
      );
      if (body) req.end(body);
      else req.end();
    });
  }

  #request(
    method: string,
    path: string,
    headers: Record<string, string>,
  ): ReturnType<typeof httpRequest> {
    const options: RequestOptions = {
      socketPath: this.#socketPath,
      method,
      path: `/${this.#apiVersion}${path.startsWith('/') ? path : `/${path}`}`,
      headers,
    };
    return httpRequest(options);
  }
}

function pathTimeout(path: string, defaultMs: number): number {
  return path.startsWith('/images/create') ? Math.max(defaultMs, 15 * 60 * 1000) : defaultMs;
}

async function collect(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const part of response) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`Docker Engine response exceeded ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
