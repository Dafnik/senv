import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { staticUpload } from './upload';
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
test('bounded multipart preserves website paths and config files while excluding local credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'senv-upload-'));
  directories.push(directory);
  await mkdir(join(directory, 'assets'));
  await mkdir(join(directory, 'cli-private'));
  vi.stubEnv('SENV_CONFIG_DIR', join(directory, 'cli-private'));
  await Promise.all([
    writeFile(join(directory, 'index.html'), '<html>'),
    writeFile(join(directory, 'assets/app.js'), 'app'),
    writeFile(join(directory, 'config.json'), '{}'),
    writeFile(join(directory, '.env'), 'secret'),
    ...['.envrc', '.npmrc', '.netrc', 'id.pem', 'id.key', 'id.p12'].map((name) =>
      writeFile(join(directory, name), 'secret'),
    ),
    writeFile(join(directory, 'cli-private/config.json'), 'bearer-secret'),
  ]);
  let uploaded = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const request = new Request(url, init);
    const bytes = await request.arrayBuffer();
    expect(headers.get('content-length')).toBe(String(bytes.byteLength));
    const decoded = new Request(url, { method: 'POST', headers, body: bytes });
    const form = await decoded.formData();
    expect(form.get('projectId')).toBe('project-id');
    const files = form.getAll('files') as File[];
    expect(files.map((file) => file.name).sort()).toEqual([
      'assets/app.js',
      'config.json',
      'index.html',
    ]);
    expect(await Promise.all(files.map((file) => file.text()))).not.toContain('bearer-secret');
    uploaded = true;
    return Response.json({ artifactId: 'artifact-id' });
  });
  expect(
    await staticUpload('http://localhost:3000', 'test-token', 'project-id', directory, {
      maxBytes: 1000,
      maxEntries: 10,
    }),
  ).toBe('artifact-id');
  expect(uploaded).toBe(true);
});
test('rejects byte limits and symlinks before making a network request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'senv-upload-reject-'));
  directories.push(directory);
  await writeFile(join(directory, 'index.html'), '123456');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    staticUpload('http://localhost:3000', 'token', 'project', directory, {
      maxBytes: 1,
      maxEntries: 10,
    }),
  ).rejects.toThrow('limit');
  await symlink(join(directory, 'index.html'), join(directory, 'linked.html'));
  await expect(
    staticUpload('http://localhost:3000', 'token', 'project', directory, {
      maxBytes: 100,
      maxEntries: 10,
    }),
  ).rejects.toThrow('Unsupported upload entry');
  expect(fetch).not.toHaveBeenCalled();
});

test('archives retain the file field, file counts are bounded, and changed files fail before being sent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'senv-upload-archive-'));
  directories.push(directory);
  const path = join(directory, 'site.zip');
  await writeFile(path, 'zip-bytes');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const request = new Request(url, init);
    const form = await request.formData();
    expect((form.get('file') as File).name).toBe('site.zip');
    expect(form.getAll('files')).toEqual([]);
    expect(request.headers.get('x-senv-project-id')).toBe('project');
    return Response.json({ artifactId: 'archive' });
  });
  expect(
    await staticUpload('http://localhost:3000', 'token', 'project', path, {
      maxBytes: 100,
      maxEntries: 1,
    }),
  ).toBe('archive');
  await writeFile(join(directory, 'second.html'), 'second');
  await expect(
    staticUpload('http://localhost:3000', 'token', 'project', directory, {
      maxBytes: 100,
      maxEntries: 1,
    }),
  ).rejects.toThrow('file-count');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    await writeFile(path, 'changed-after-preflight');
    await new Request(url, init).arrayBuffer();
    return Response.json({ artifactId: 'impossible' });
  });
  await expect(
    staticUpload('http://localhost:3000', 'token', 'project', path, {
      maxBytes: 100,
      maxEntries: 1,
    }),
  ).rejects.toThrow('changed');
});

test.skipIf(process.platform === 'win32')(
  'special files are rejected without reading or sending them',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'senv-upload-fifo-'));
    directories.push(directory);
    execFileSync('mkfifo', [join(directory, 'pipe')]);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      staticUpload('http://localhost:3000', 'token', 'project', directory, {
        maxBytes: 100,
        maxEntries: 10,
      }),
    ).rejects.toThrow('Unsupported upload entry');
    expect(fetch).not.toHaveBeenCalled();
  },
);
