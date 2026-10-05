import { lstat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { basename, join, resolve, sep } from 'node:path';
import { CliError } from '../errors.ts';
import { configDirectory } from '../profiles.ts';

const excluded = new Set(['.senv.json', '.git', '.env', '.env.local']);
export async function staticUpload(
  apiUrl: string,
  token: string,
  projectId: string,
  path: string,
  limits: { maxBytes: number; maxEntries: number },
  options: { signal?: AbortSignal; onProgress?: (sent: number, total: number) => void } = {},
) {
  options.signal?.throwIfAborted();
  const root = resolve(path);
  const credentials = resolve(configDirectory());
  if (root === credentials || root.startsWith(`${credentials}${sep}`))
    throw new CliError('The CLI credential directory cannot be uploaded.', 2);
  const info = await lstat(root);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
    throw new CliError(
      'Upload a regular archive or directory; symlinks and special files are excluded.',
      2,
    );
  const files: Array<{ name: string; path: string; stat: Awaited<ReturnType<typeof lstat>> }> = [];
  let size = 0;
  async function add(file: string, name: string) {
    options.signal?.throwIfAborted();
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new CliError(`Unsupported upload entry: ${name}`, 2);
    size += stat.size;
    if (size > limits.maxBytes || files.length >= limits.maxEntries)
      throw new CliError('Upload exceeds the instance byte or file-count limit.', 2);
    files.push({ name, path: file, stat });
  }
  async function walk(directory: string, prefix = '') {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new CliError('Upload directories cannot be symbolic links.', 2);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      options.signal?.throwIfAborted();
      if (resolve(directory, entry.name) === credentials) continue;
      if (excluded.has(entry.name) || entry.name.startsWith('.env.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
      else await add(join(directory, entry.name), relative);
    }
  }
  if (info.isDirectory()) await walk(root);
  else await add(root, basename(root));
  if (!files.length) throw new CliError('The selected directory or archive is empty.', 2);

  const boundary = `senv-${randomUUID()}`;
  const escaped = (name: string) =>
    name.replaceAll('"', '%22').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const projectPart = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n${projectId}\r\n`,
  );
  const headers = files.map((file) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${info.isDirectory() ? 'files' : 'file'}"; filename="${escaped(file.name)}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  const end = Buffer.from(`--${boundary}--\r\n`);
  const contentLength =
    size +
    projectPart.length +
    end.length +
    headers.reduce((total, header) => total + header.length + 2, 0);
  let sent = 0;
  options.onProgress?.(0, size);
  async function* multipart() {
    yield projectPart;
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!;
      const handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.ino !== file.stat.ino ||
          opened.dev !== file.stat.dev ||
          opened.size !== file.stat.size ||
          opened.mtimeMs !== file.stat.mtimeMs
        )
          throw new CliError('An upload entry changed during preparation. Retry.', 2);
        yield headers[index]!;
        let read = 0;
        for await (const bytes of handle.createReadStream({ autoClose: false })) {
          options.signal?.throwIfAborted();
          read += bytes.length;
          sent += bytes.length;
          options.onProgress?.(sent, size);
          if (read > file.stat.size) throw new CliError('An upload file changed. Retry.', 2);
          yield bytes as Buffer;
        }
        const after = await handle.stat();
        if (read !== file.stat.size || after.mtimeMs !== opened.mtimeMs)
          throw new CliError('An upload file changed. Retry.', 2);
        yield Buffer.from('\r\n');
      } finally {
        await handle.close();
      }
    }
    yield end;
  }
  // Node's fetch accepts a stream with duplex=half. Calculate the exact length
  // from preflight metadata, because the server rejects unbounded uploads.
  const body = Readable.from(multipart());
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/deployments/artifacts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(contentLength),
      },
      body: body as unknown as BodyInit,
      duplex: 'half',
      redirect: 'error',
      signal: AbortSignal.any([
        AbortSignal.timeout(120_000),
        ...(options.signal ? [options.signal] : []),
      ]),
    } as RequestInit & { duplex: 'half' });
  } finally {
    body.destroy();
  }
  const value = (await response.json().catch(() => ({}))) as {
    artifactId?: string;
    statusMessage?: string;
    message?: string;
  };
  if (!response.ok || !value.artifactId)
    throw new CliError(
      value.statusMessage ?? value.message ?? 'Artifact upload failed.',
      response.status === 401 ? 3 : response.status === 403 ? 4 : 1,
    );
  return value.artifactId;
}
