import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test, vi } from 'vite-plus/test';
import { stageArtifactUpload } from './artifact-multipart';
import { store, makeZip, makeTar } from './artifacts-test-support';
import { withArtifactStorageLock } from './artifacts';

function request(data: Buffer, name = 'site.zip') {
  const form = new FormData();
  form.set('projectId', 'project');
  form.set('kind', 'static');
  form.set('source', JSON.stringify({ branch: 'main' }));
  form.set('file', new File([new Uint8Array(data)], name));
  return new Request('http://localhost/upload', { method: 'POST', body: form });
}

test('streamed ZIP and TAR uploads match directory hashes and retain Unicode filenames', async () => {
  const { root, store: artifacts } = await store(10_000);
  const files = [
    { name: 'index.html', data: Buffer.from('index') },
    { name: 'assets/été.txt', data: Buffer.from('contents') },
  ];
  const expected = await artifacts.ingestFiles(files);
  for (const [name, bytes] of [
    [
      'site.zip',
      makeZip(files.map((file) => ({ name: file.name, data: file.data.toString(), method: 8 }))),
    ],
    [
      'site.tar.gz',
      gzipSync(
        await makeTar(files.map((file) => ({ name: file.name, data: file.data.toString() }))),
      ),
    ],
  ] as const) {
    const staged = await stageArtifactUpload(request(bytes, name), root, 10_000);
    expect(staged.fields.get('source')).toBe('{"branch":"main"}');
    const register = vi.fn();
    expect(await artifacts.ingestStaged(staged.files, register)).toEqual(expected);
    expect(register).toHaveBeenCalledWith(expected);
    await staged.dispose();
  }
  expect(await readdir(join(root, 'tmp'))).toEqual([]);
});

test('streamed archives reject traversal, duplicate paths, links, corrupt CRC, and expansion bombs before registration', async () => {
  const { root, store: artifacts } = await store(400);
  const corrupt = makeZip([{ name: 'index.html', data: 'contents' }]);
  corrupt[30 + 'index.html'.length] = 0;
  for (const archive of [
    makeZip([{ name: '../index.html', data: 'x' }]),
    makeZip([{ name: 'index.html', data: 'x', mode: 0o120777 }]),
    makeZip([
      { name: 'index.html', data: 'a' },
      { name: 'index.html', data: 'b' },
    ]),
    makeZip([{ name: 'index.html', data: 'x'.repeat(401), method: 8 }]),
    corrupt,
  ]) {
    const filename = join(root, 'tmp/archive.zip');
    await writeFile(filename, archive);
    const register = vi.fn();
    await expect(
      artifacts.ingestStaged(
        [{ field: 'file', name: 'site.zip', filename, size: archive.length }],
        register,
      ),
    ).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();
    expect((await readdir(join(root, 'tmp'))).filter((name) => name.startsWith('upload-'))).toEqual(
      [],
    );
  }
});

test('multipart file limits bound actual bytes and remove staging files on oversized or malformed requests', async () => {
  const { root } = await store();
  await expect(stageArtifactUpload(request(Buffer.alloc(401)), root, 400)).rejects.toThrow('limit');
  const malformed = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data' },
    body: 'bad',
  });
  await expect(stageArtifactUpload(malformed, root, 400)).rejects.toThrow();
  expect(await readdir(join(root, 'tmp'))).toEqual([]);
  const form = new FormData();
  form.set('projectId', 'project');
  form.append('files', new File(['a'], 'site/index.html'));
  form.append('files', new File(['b'], 'site/assets/été.txt'));
  const staged = await stageArtifactUpload(
    new Request('http://localhost/upload', { method: 'POST', body: form }),
    root,
    2,
  );
  expect(staged.files.map((file) => file.name)).toEqual(['site/index.html', 'site/assets/été.txt']);
  expect(await readFile(staged.files[1]!.filename, 'utf8')).toBe('b');
  await staged.dispose();
});

test('extraction completes outside the storage lock and waits only to commit and register', async () => {
  const { root, store: artifacts } = await store(10_000);
  const staged = await stageArtifactUpload(
    request(makeZip([{ name: 'index.html', data: 'index', method: 8 }])),
    root,
    10_000,
  );
  let release!: () => void;
  let locked!: () => void;
  const entered = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const lock = withArtifactStorageLock(root, async () => {
    locked();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await entered;
  const register = vi.fn();
  const upload = artifacts.ingestStaged(staged.files, register);
  await vi.waitFor(async () => {
    const directory = (await readdir(join(root, 'tmp'))).find((name) => name.startsWith('upload-'));
    expect(directory).toBeDefined();
    expect(await readFile(join(root, 'tmp', directory!, 'index.html'), 'utf8')).toBe('index');
  });
  expect(register).not.toHaveBeenCalled();
  release();
  await lock;
  await upload;
  expect(register).toHaveBeenCalledTimes(1);
  await staged.dispose();
});
