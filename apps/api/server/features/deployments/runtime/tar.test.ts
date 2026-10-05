import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { writeTarFromDirectory } from './tar';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('writes PAX path metadata for long website names without losing file bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'senv-tar-test-'));
  roots.push(root);
  const source = join(root, 'source');
  const nested = join(source, 'a'.repeat(105));
  await mkdir(nested, { recursive: true });
  const name = `${'b'.repeat(110)}.js`;
  await writeFile(join(nested, name), 'asset');
  const destination = join(root, 'site.tar');
  await writeTarFromDirectory(source, destination);
  const archive = await readFile(destination);
  const paxRecords: string[] = [];
  let offset = 0;
  while (offset + 512 <= archive.length && archive[offset] !== 0) {
    const size = Number.parseInt(
      archive
        .subarray(offset + 124, offset + 136)
        .toString()
        .replace(/\0.*$/, '')
        .trim(),
      8,
    );
    const type = String.fromCharCode(archive[offset + 156]!);
    if (type === 'x')
      paxRecords.push(archive.subarray(offset + 512, offset + 512 + size).toString());
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  expect(paxRecords.some((record) => record.includes(`path=${'a'.repeat(105)}/`))).toBe(true);
  expect(paxRecords.some((record) => record.includes(`${'b'.repeat(110)}.js`))).toBe(true);
  expect(archive.includes(Buffer.from('PaxFile'))).toBe(true);
});
