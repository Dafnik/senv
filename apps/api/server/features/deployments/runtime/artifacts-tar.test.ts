import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { makeTar, makeZip, store } from './artifacts-test-support';

test('ingests TAR with all Node compression codecs and the same content hash as ZIP', async () => {
  const { gzipSync, deflateSync, deflateRawSync, brotliCompressSync, zstdCompressSync } =
    await import('node:zlib');
  const { root, store: artifactStore } = await store(20_000);
  const tar = await makeTar([
    { name: './', type: 'directory' },
    { name: './index.html', data: '<h1>hello</h1>' },
    { name: './assets/app.js', data: 'console.log(1)' },
  ]);
  const zip = await artifactStore.ingestArchive(
    makeZip([
      { name: 'index.html', data: '<h1>hello</h1>' },
      { name: 'assets/app.js', data: 'console.log(1)' },
    ]),
    'website.ZIP',
  );
  for (const [name, data] of [
    ['website.tar', tar],
    ['website.tgz', gzipSync(tar)],
    ['website.tar.gz', gzipSync(tar)],
    ['website.tar.deflate', deflateSync(tar)],
    ['website.tar.deflate-raw', deflateRawSync(tar)],
    ['website.tar.br', brotliCompressSync(tar)],
    ['website.tar.zst', zstdCompressSync(tar)],
  ] as const) {
    expect(await artifactStore.ingestArchive(data, name)).toEqual(zip);
  }
  expect(await readFile(join(root, 'artifacts', zip.storageKey, 'assets/app.js'), 'utf8')).toBe(
    'console.log(1)',
  );
});

test('TAR rejects unsafe paths, duplicate files, links, corrupt headers and truncation', async () => {
  const { store: artifactStore } = await store(20_000);
  for (const entry of [
    { name: '../index.html', data: 'bad' },
    { name: '/index.html', data: 'bad' },
    { name: 'index.html', type: 'symlink' as const, linkname: '../../outside' },
    { name: 'index.html', type: 'link' as const, linkname: 'outside' },
  ]) {
    await expect(artifactStore.ingestArchive(await makeTar([entry]), 'site.tar')).rejects.toThrow();
  }
  await expect(
    artifactStore.ingestArchive(
      await makeTar([
        { name: 'index.html', data: 'a' },
        { name: './index.html', data: 'b' },
      ]),
      'site.tar',
    ),
  ).rejects.toThrow('Duplicate website path');
  const corrupt = await makeTar([{ name: 'index.html', data: 'hello' }]);
  corrupt[0] = corrupt[0]! ^ 1;
  await expect(artifactStore.ingestArchive(corrupt, 'site.tar')).rejects.toThrow();
  const truncated = (await makeTar([{ name: 'index.html', data: 'x'.repeat(2000) }])).subarray(
    0,
    1000,
  );
  await expect(artifactStore.ingestArchive(truncated, 'site.tar')).rejects.toThrow();
});

test('compressed TAR enforces expanded file quotas, upload quotas and root index validation', async () => {
  const { gzipSync } = await import('node:zlib');
  const { store: artifactStore } = await store(256);
  await expect(
    artifactStore.ingestArchive(
      gzipSync(await makeTar([{ name: 'index.html', data: 'x'.repeat(257) }])),
      'site.tgz',
    ),
  ).rejects.toThrow('Extracted website exceeds');
  await expect(artifactStore.ingestArchive(Buffer.alloc(257), 'site.tar')).rejects.toThrow(
    'Uploaded archive exceeds',
  );
  await expect(
    artifactStore.ingestArchive(
      gzipSync(await makeTar([{ name: 'dist/index.html', data: 'hello' }])),
      'site.tgz',
    ),
  ).rejects.toThrow('root must contain index.html');
  await expect(artifactStore.ingestArchive(Buffer.from('invalid'), 'site.rar')).rejects.toThrow(
    'supported compression format',
  );
});
