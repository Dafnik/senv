import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { expect, test } from 'vite-plus/test';
import { store } from './artifacts-test-support';
import {
  browseArtifact,
  downloadArtifactArchive,
  openArtifactFile,
  resolveArtifactPath,
} from './artifact-browser';
import { extractZip } from './artifact-zip';
import { extractTar } from './artifact-tar';

async function bytes(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const files = [
  { name: 'index.html', data: Buffer.from('<h1>Artifact</h1>') },
  { name: 'assets/app.js', data: Buffer.from('console.log("artifact")') },
  { name: 'assets/empty.txt', data: Buffer.alloc(0) },
  { name: 'images/été & 100%.svg', data: Buffer.from('<svg/>') },
];

test('browsing lists only direct entries with directories first and exact file sizes', async () => {
  const { root, store: artifacts } = await store();
  const saved = await artifacts.ingestFiles(files);
  expect(await browseArtifact(root, saved.storageKey)).toEqual({
    path: '',
    size: files.reduce((sum, file) => sum + file.data.length, 0),
    entries: [
      { name: 'assets', path: 'assets', kind: 'directory', size: files[1]!.data.length },
      { name: 'images', path: 'images', kind: 'directory', size: files[3]!.data.length },
      { name: 'index.html', path: 'index.html', kind: 'file', size: files[0]!.data.length },
    ],
  });
  const folder = await browseArtifact(root, saved.storageKey, 'assets');
  expect(folder.entries.map((entry) => entry.path)).toEqual(['assets/app.js', 'assets/empty.txt']);
  const file = await openArtifactFile(root, saved.storageKey, 'images/été & 100%.svg');
  expect(file.size).toBe(6);
  expect(await bytes(file.stream)).toEqual(files[3]!.data);
});

for (const format of ['zip', 'tar.gz'] as const) {
  test(`${format} downloads round-trip every file, including nested, empty, and Unicode files`, async () => {
    const { root, store: artifacts } = await store();
    const saved = await artifacts.ingestFiles(files);
    const archive = await bytes(await downloadArtifactArchive(root, saved.storageKey, format));
    const extracted =
      format === 'zip'
        ? await extractZip(archive, 1000)
        : await extractTar(archive, 'artifact.tar.gz', 1000);
    expect(extracted.sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      [...files].sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
}

test('paths reject traversal, absolute paths, links, files used as directories, and missing storage', async () => {
  const { root, store: artifacts } = await store();
  const saved = await artifacts.ingestFiles(files);
  for (const path of [
    '../index.html',
    'assets/../../index.html',
    '/index.html',
    'assets\\app.js',
    'assets//app.js',
    'assets/./app.js',
    'index.html\0',
  ]) {
    await expect(resolveArtifactPath(root, saved.storageKey, path)).rejects.toThrow(
      'valid artifact path',
    );
  }
  await expect(browseArtifact(root, saved.storageKey, 'index.html')).rejects.toThrow('directory');
  await expect(openArtifactFile(root, saved.storageKey, 'assets')).rejects.toThrow(
    'regular artifact file',
  );
  await expect(browseArtifact(root, saved.storageKey, 'missing')).rejects.toThrow('not found');
  await expect(browseArtifact(root, 'bad-key')).rejects.toThrow('Invalid artifact key');
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(outside, join(root, 'artifacts', saved.storageKey, 'link'));
  await expect(openArtifactFile(root, saved.storageKey, 'link/secret.txt')).rejects.toThrow(
    'links',
  );
  await expect(downloadArtifactArchive(root, saved.storageKey, 'zip')).rejects.toThrow('links');
  await artifacts.remove(saved.storageKey);
  await expect(browseArtifact(root, saved.storageKey)).rejects.toThrow('no longer available');
});

test('file previews return bounded UTF-8 code, image metadata, and download fallbacks', async () => {
  const { previewArtifactFile } = await import('./artifact-browser');
  const { root, store: artifacts } = await store(300_000);
  const saved = await artifacts.ingestFiles([
    ...files,
    { name: 'large.js', data: Buffer.alloc(256 * 1024 + 1, 65) },
    { name: 'binary.js', data: Buffer.from([0, 255]) },
    { name: 'bundle.wasm', data: Buffer.from([0, 1, 2]) },
  ]);
  expect(await previewArtifactFile(root, saved.storageKey, 'assets/app.js')).toMatchObject({
    kind: 'code',
    language: 'javascript',
    text: 'console.log("artifact")',
  });
  expect(await previewArtifactFile(root, saved.storageKey, 'images/été & 100%.svg')).toMatchObject({
    kind: 'image',
    mime: 'image/svg+xml',
    text: null,
  });
  expect(await previewArtifactFile(root, saved.storageKey, 'large.js')).toMatchObject({
    text: null,
    reason: expect.stringContaining('too large'),
  });
  expect(await previewArtifactFile(root, saved.storageKey, 'binary.js')).toMatchObject({
    text: null,
    reason: expect.stringContaining('UTF-8'),
  });
  expect(await previewArtifactFile(root, saved.storageKey, 'bundle.wasm')).toMatchObject({
    kind: 'download',
    text: null,
  });
});
