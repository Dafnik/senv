import {
  createGunzip,
  createInflate,
  createInflateRaw,
  createBrotliDecompress,
  createZstdDecompress,
} from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract } from 'tar-stream';
import type { StaticUploadFile } from './artifact-types';
import { safeRelativePath } from './artifact-paths';
import { maxStaticArtifactEntries } from './artifact-limits';

export async function extractTar(
  archive: Buffer,
  filename: string,
  maxBytes: number,
): Promise<StaticUploadFile[]> {
  const decompressor = /\.(?:tgz|gz|gzip)$/.test(filename)
    ? createGunzip()
    : filename.endsWith('.br')
      ? createBrotliDecompress()
      : /\.(?:zst|zstd|tzst)$/.test(filename)
        ? createZstdDecompress()
        : filename.endsWith('.deflate-raw')
          ? createInflateRaw()
          : /\.(?:zz|zlib|deflate)$/.test(filename)
            ? createInflate()
            : null;
  // Bound metadata and padding as well as file bodies, including PAX records.
  const maxTarBytes = maxBytes + maxStaticArtifactEntries * 2048 + 1024 * 1024;
  let tarBytes = 0;
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      tarBytes += chunk.length;
      callback(
        tarBytes > maxTarBytes ? new Error('TAR metadata exceeds the archive limit.') : null,
        chunk,
      );
    },
  });
  const parser = extract();
  const files: StaticUploadFile[] = [];
  const seen = new Set<string>();
  let entries = 0;
  let total = 0;
  parser.on('entry', (header, entry, next) => {
    // Validation can fail before iteration attaches an error listener. The
    // parser's pipeline reports the error when it destroys its entry stream.
    entry.on('error', () => {});
    void (async () => {
      if (++entries > maxStaticArtifactEntries)
        throw new Error(`TAR archive exceeds the ${maxStaticArtifactEntries}-entry limit.`);
      if (header.type !== 'file' && header.type !== 'directory')
        throw new Error('TAR entries must be regular files or directories; links are not allowed.');
      const normalized = header.name.replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
      if (header.type === 'directory' && (normalized === '' || normalized === '.')) {
        if (header.size) throw new Error('TAR directory entries cannot contain file data.');
        entry.resume();
        next();
        return;
      }
      const name = safeRelativePath(normalized);
      if (seen.has(name)) throw new Error(`Duplicate website path: ${name}`);
      seen.add(name);
      if (!Number.isSafeInteger(header.size) || (header.size ?? 0) < 0)
        throw new Error('Invalid TAR entry size.');
      if (header.type === 'directory') {
        if (header.size) throw new Error('TAR directory entries cannot contain file data.');
        entry.resume();
        next();
        return;
      }
      if (total + (header.size ?? 0) > maxBytes)
        throw new Error(`Extracted website exceeds the ${maxBytes}-byte limit.`);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of entry) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Invalid TAR file data.');
        const bytes = chunk;
        size += bytes.length;
        if (total + size > maxBytes)
          throw new Error(`Extracted website exceeds the ${maxBytes}-byte limit.`);
        chunks.push(bytes);
      }
      if (size !== header.size) throw new Error('TAR entry size does not match its contents.');
      total += size;
      files.push({ name, data: Buffer.concat(chunks) });
      next();
    })().catch((error: Error) => {
      entry.destroy(error);
      parser.destroy(error);
    });
  });
  if (decompressor) await pipeline(Readable.from([archive]), decompressor, bounded, parser);
  else await pipeline(Readable.from([archive]), bounded, parser);
  return files;
}
