import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';
import { safeRelativePath, stripSelectedDirectoryRoot, withArtifactStorageLock } from './artifacts';
import { makeZip, roots, store } from './artifacts-test-support';

test('stores safe ZIP root files by deterministic content hash', async () => {
  const { root, store: artifactStore } = await store();
  const first = await artifactStore.ingestZip(
    makeZip([
      { name: 'index.html', data: '<h1>hello</h1>' },
      { name: 'assets/app.js', data: 'console.log(1)' },
    ]),
  );
  const second = await artifactStore.ingestZip(
    makeZip([
      { name: 'assets/app.js', data: 'console.log(1)' },
      { name: 'index.html', data: '<h1>hello</h1>' },
    ]),
  );
  expect(first).toEqual(second);
  expect(await readFile(join(root, 'artifacts', first.storageKey, 'index.html'), 'utf8')).toBe(
    '<h1>hello</h1>',
  );
  expect(await artifactStore.exists(first.storageKey)).toBe(true);
});

test('strips the browser selected-directory prefix once and requires a root index', async () => {
  const { store: artifactStore } = await store();
  const files = stripSelectedDirectoryRoot([
    { name: 'dist/index.html', data: Buffer.from('index') },
    { name: 'dist/assets/app.js', data: Buffer.from('app') },
  ]);
  expect(files.map((file) => file.name)).toEqual(['index.html', 'assets/app.js']);
  await expect(artifactStore.ingestFiles(files)).resolves.toMatchObject({ size: 8 });
  const nestedRoot = stripSelectedDirectoryRoot([
    { name: 'dist/browser/index.html', data: Buffer.from('nested') },
  ]);
  await expect(artifactStore.ingestFiles(nestedRoot)).rejects.toThrow(
    'root must contain index.html',
  );
});

test('enforces the upload and total expanded-byte quotas', async () => {
  const { store: artifactStore } = await store(256);
  await expect(artifactStore.ingestZip(Buffer.alloc(257))).rejects.toThrow('Uploaded ZIP exceeds');
  await expect(
    artifactStore.ingestZip(makeZip([{ name: 'index.html', data: 'x'.repeat(257), method: 8 }])),
  ).rejects.toThrow('Extracted website exceeds');
  await expect(
    artifactStore.ingestFiles([
      { name: 'index.html', data: Buffer.alloc(129) },
      { name: 'app.js', data: Buffer.alloc(128) },
    ]),
  ).rejects.toThrow('Extracted website exceeds');
});

test('rejects traversal, absolute and duplicate paths from directories and ZIPs', async () => {
  const { store: artifactStore } = await store();
  expect(() => safeRelativePath('../index.html')).toThrow('unsafe segment');
  expect(() => safeRelativePath('/index.html')).toThrow('safe relative path');
  expect(() => safeRelativePath('assets\\app.js')).toThrow('safe relative path');
  await expect(
    artifactStore.ingestFiles([
      { name: 'index.html', data: Buffer.from('a') },
      { name: 'index.html', data: Buffer.from('b') },
    ]),
  ).rejects.toThrow('Duplicate website path');
  await expect(
    artifactStore.ingestZip(makeZip([{ name: '../index.html', data: 'bad' }])),
  ).rejects.toThrow('unsafe segment');
  await expect(
    artifactStore.ingestZip(
      makeZip([
        { name: 'index.html', data: 'a' },
        { name: 'index.html', data: 'b' },
      ]),
    ),
  ).rejects.toThrow('Duplicate website path');
});

test('rejects symbolic links and archives without a root index', async () => {
  const { store: artifactStore } = await store();
  await expect(
    artifactStore.ingestZip(makeZip([{ name: 'index.html', data: 'x', mode: 0o120777 }])),
  ).rejects.toThrow('symbolic links');
  await expect(
    artifactStore.ingestZip(makeZip([{ name: 'dist/index.html', data: 'x' }])),
  ).rejects.toThrow('root must contain index.html');
});

test('serializes artifact uploads and cleanup for a shared storage root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'senv-artifact-lock-test-'));
  roots.push(root);
  const order: string[] = [];
  let entered!: () => void;
  let release!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const upload = withArtifactStorageLock(root, async () => {
    order.push('upload-start');
    entered();
    await gate;
    order.push('upload-finished');
  });
  await firstEntered;
  const cleanup = withArtifactStorageLock(root, () => {
    order.push('cleanup');
  });
  expect(order).toEqual(['upload-start']);
  release();
  await Promise.all([upload, cleanup]);
  expect(order).toEqual(['upload-start', 'upload-finished', 'cleanup']);
});
