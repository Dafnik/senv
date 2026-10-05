import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import { open, type Entry, type ZipFile } from 'yauzl';
import { safeRelativePath } from './artifact-paths';
import { maxStaticArtifactEntries } from './artifact-limits';

export async function extractZipToDirectory(filename: string, directory: string, maxBytes: number) {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    open(
      filename,
      { lazyEntries: true, strictFileNames: true, autoClose: false },
      (error, value) => (error ? reject(error) : resolve(value!)),
    ),
  );
  let total = 0;
  let entries = 0;
  const seen = new Set<string>();
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          if (++entries > maxStaticArtifactEntries)
            throw new Error(`ZIP archive exceeds the ${maxStaticArtifactEntries}-entry limit.`);
          const directoryEntry = entry.fileName.endsWith('/');
          const name = safeRelativePath(
            directoryEntry ? entry.fileName.slice(0, -1) : entry.fileName,
          );
          if (seen.has(name)) throw new Error(`Duplicate website path: ${name}`);
          seen.add(name);
          const mode = entry.externalFileAttributes >>> 16;
          const type = mode & 0o170000;
          if (type === 0o120000) throw new Error('ZIP symbolic links are not allowed.');
          if (type && type !== 0o100000 && type !== 0o040000)
            throw new Error('ZIP entries must be regular files or directories.');
          if (entry.isEncrypted()) throw new Error('Encrypted ZIP entries are not supported.');
          if (directoryEntry) {
            zip.readEntry();
            return;
          }
          if (total + entry.uncompressedSize > maxBytes)
            throw new Error(`Extracted website exceeds the ${maxBytes}-byte limit.`);
          const target = join(directory, ...name.split('/'));
          await mkdir(dirname(target), { recursive: true, mode: 0o755 });
          const stream = await new Promise<Readable>((res, rej) =>
            zip.openReadStream(entry, (error, value) => (error ? rej(error) : res(value!))),
          );
          let size = 0;
          let checksum = 0;
          const verify = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              size += chunk.length;
              checksum = crc32(chunk, checksum);
              callback(
                total + size > maxBytes
                  ? new Error(`Extracted website exceeds the ${maxBytes}-byte limit.`)
                  : null,
                chunk,
              );
            },
          });
          await pipeline(stream, verify, createWriteStream(target, { flags: 'wx', mode: 0o644 }));
          if (size !== entry.uncompressedSize || checksum !== entry.crc32)
            throw new Error('ZIP entry integrity check failed.');
          total += size;
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    return total;
  } finally {
    zip.close();
  }
}
