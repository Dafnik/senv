import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterEach, expect, test } from 'vite-plus/test';
import {
  ArtifactStore,
  safeRelativePath,
  stripSelectedDirectoryRoot,
  withArtifactStorageLock,
} from './artifacts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store(maxBytes = 1_000) {
  const root = await mkdtemp(join(tmpdir(), 'senv-artifacts-test-'));
  roots.push(root);
  const value = new ArtifactStore({ root, maxBytes });
  await value.initialize();
  return { root, store: value };
}

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

function makeZip(
  entries: Array<{ name: string; data: string; method?: 0 | 8; mode?: number }>,
): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const packed = entry.method === 8 ? deflateRawSync(data) : data;
    const method = entry.method ?? 0;
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(packed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    name.copy(localHeader, 30);
    local.push(localHeader, packed);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(packed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    central.push(centralHeader);
    offset += localHeader.length + packed.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, eocd]);
}

async function makeTar(
  entries: Array<{
    name: string;
    data?: string;
    type?: 'file' | 'directory' | 'symlink' | 'link';
    linkname?: string;
  }>,
) {
  const { pack } = await import('tar-stream');
  const tar = pack();
  for (const entry of entries)
    tar.entry(
      { name: entry.name, type: entry.type ?? 'file', linkname: entry.linkname },
      entry.data ?? '',
    );
  tar.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of tar) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

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
