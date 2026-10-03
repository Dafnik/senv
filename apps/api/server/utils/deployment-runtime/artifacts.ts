import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  crc32,
  inflateRaw,
  createGunzip,
  createInflate,
  createInflateRaw,
  createBrotliDecompress,
  createZstdDecompress,
} from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract } from 'tar-stream';
import { staticArchiveExtensions } from '../../../shared/deployments';
import { promisify } from 'node:util';
export { withArtifactStorageLock } from '../deployment-storage-lock';

export type StaticUploadFile = { name: string; data: Buffer };
export type StoredArtifact = { storageKey: string; size: number; sha256: string };
export type ArtifactStoreOptions = { root: string; maxBytes: number };

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const inflateRawAsync = promisify(inflateRaw);

/** Persistent, content-addressed static artifact storage. Uploads are committed by atomic rename. */
export class ArtifactStore {
  constructor(readonly options: ArtifactStoreOptions) {}

  async initialize(): Promise<void> {
    await mkdir(join(this.options.root, 'artifacts'), { recursive: true, mode: 0o755 });
    await chmod(this.options.root, 0o755);
    await chmod(join(this.options.root, 'artifacts'), 0o755);
    await mkdir(join(this.options.root, 'tmp'), { recursive: true, mode: 0o700 });
  }

  async ingestFiles(files: StaticUploadFile[]): Promise<StoredArtifact> {
    if (files.length > 10_000) throw new Error('Website exceeds the 10000-file limit.');
    if (!files.length) throw new Error('At least one website file is required.');
    const temp = await mkdtemp(join(this.options.root, 'tmp/upload-'));
    try {
      await chmod(temp, 0o755);
      const seen = new Set<string>();
      let total = 0;
      for (const file of files) {
        const name = safeRelativePath(file.name);
        if (seen.has(name)) throw new Error(`Duplicate website path: ${name}`);
        seen.add(name);
        total += file.data.byteLength;
        if (total > this.options.maxBytes)
          throw new Error(`Extracted website exceeds the ${this.options.maxBytes}-byte limit.`);
        const target = join(temp, ...name.split('/'));
        await mkdir(dirname(target), { recursive: true, mode: 0o755 });
        await writeFile(target, file.data, { flag: 'wx', mode: 0o644 });
      }
      return await this.#commit(temp, total);
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
  }

  async ingestZip(zip: Buffer): Promise<StoredArtifact> {
    if (zip.byteLength > this.options.maxBytes)
      throw new Error(`Uploaded ZIP exceeds the ${this.options.maxBytes}-byte limit.`);
    const files = await extractZip(zip, this.options.maxBytes);
    return this.ingestFiles(files);
  }

  async ingestArchive(archive: Buffer, filename: string): Promise<StoredArtifact> {
    const lower = filename.toLowerCase();
    if (!staticArchiveExtensions.some((extension) => lower.endsWith(extension)))
      throw new Error('Select a ZIP or TAR archive with a supported compression format.');
    if (lower.endsWith('.zip')) return this.ingestZip(archive);
    if (archive.byteLength > this.options.maxBytes)
      throw new Error(`Uploaded archive exceeds the ${this.options.maxBytes}-byte limit.`);
    return this.ingestFiles(await extractTar(archive, lower, this.options.maxBytes));
  }

  async remove(storageKey: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(storageKey)) throw new Error('Invalid artifact storage key.');
    await rm(join(this.options.root, 'artifacts', storageKey), { recursive: true, force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(storageKey)) return false;
    try {
      return (await stat(join(this.options.root, 'artifacts', storageKey, 'index.html'))).isFile();
    } catch {
      return false;
    }
  }

  #commit(temp: string, total: number): Promise<StoredArtifact> {
    return (async () => {
      const index = join(temp, 'index.html');
      if (!(await stat(index).catch(() => null))?.isFile())
        throw new Error('Website root must contain index.html.');
      const digest = createHash('sha256');
      // Hash a deterministic stream of paths and bytes so identical trees share storage.
      const { readdir, readFile } = await import('node:fs/promises');
      const visit = async (dir: string, relative = ''): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (!entry.isFile() && !entry.isDirectory())
            throw new Error('Website entries must be regular files or directories.');
          const path = relative ? `${relative}/${entry.name}` : entry.name;
          const pathBytes = Buffer.from(path);
          digest.update(entry.isDirectory() ? 'D' : 'F');
          digest.update(uint64(pathBytes.byteLength)).update(pathBytes);
          if (entry.isDirectory()) await visit(join(dir, entry.name), path);
          else {
            const bytes = await readFile(join(dir, entry.name));
            digest.update(uint64(bytes.byteLength)).update(bytes);
          }
        }
      };
      await visit(temp);
      const sha256 = digest.digest('hex');
      const destination = join(this.options.root, 'artifacts', sha256);
      await mkdir(dirname(destination), { recursive: true, mode: 0o750 });
      try {
        await rename(temp, destination);
      } catch (error) {
        // A matching content-addressed artifact may already exist from a concurrent publish.
        if (!(await this.exists(sha256))) throw error;
        await rm(temp, { recursive: true, force: true });
      }
      return { storageKey: sha256, size: total, sha256 };
    })();
  }
}

function uint64(value: number): Buffer {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

export function safeRelativePath(input: string): string {
  if (
    !input ||
    input.includes('\0') ||
    input.includes('\\') ||
    input.startsWith('/') ||
    /^[a-zA-Z]:/.test(input)
  ) {
    throw new Error('Website file path must be a safe relative path.');
  }
  const parts = input.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new Error('Website file path contains an unsafe segment.');
  return parts.join('/');
}

/** Removes the one directory prefix browsers add for a selected webkitdirectory root. */
export function stripSelectedDirectoryRoot(files: StaticUploadFile[]): StaticUploadFile[] {
  const names = files.map((file) => safeRelativePath(file.name));
  const firstSegments = new Set(names.map((name) => name.split('/')[0]));
  if (firstSegments.size !== 1 || !names.some((name) => name.includes('/')))
    return files.map((file, index) => ({ ...file, name: names[index]! }));
  const root = [...firstSegments][0]!;
  const prefix = `${root}/`;
  if (names.some((name) => !name.startsWith(prefix)))
    throw new Error('Directory upload paths must share one selected root.');
  return files.map((file, index) => ({ ...file, name: names[index]!.slice(prefix.length) }));
}

async function extractZip(zip: Buffer, maxExpandedBytes: number): Promise<StaticUploadFile[]> {
  const eocd = findEocd(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  if (entryCount > 10_000) throw new Error('ZIP archive exceeds the 10000-entry limit.');
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new Error('ZIP64 archives are not supported.');
  if (centralOffset + centralSize > eocd) throw new Error('Invalid ZIP central directory.');
  let cursor = centralOffset;
  let total = 0;
  const seen = new Set<string>();
  const files: StaticUploadFile[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== ZIP_CENTRAL)
      throw new Error('Invalid ZIP central directory entry.');
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const externalAttrs = zip.readUInt32LE(cursor + 38);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const rawName = zip
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString(flags & 0x800 ? 'utf8' : 'latin1');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error('Encrypted ZIP entries are not supported.');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      throw new Error('ZIP64 archives are not supported.');
    const unixMode = externalAttrs >>> 16;
    const fileType = unixMode & 0o170000;
    if (fileType === 0o120000) throw new Error('ZIP symbolic links are not allowed.');
    if (fileType && fileType !== 0o100000 && fileType !== 0o040000)
      throw new Error('ZIP entries must be regular files or directories.');
    const isDirectory = rawName.endsWith('/');
    const name = safeRelativePath(isDirectory ? rawName.slice(0, -1) : rawName);
    if (seen.has(name)) throw new Error(`Duplicate website path: ${name}`);
    seen.add(name);
    if (isDirectory) continue;
    if (method !== 0 && method !== 8)
      throw new Error(`ZIP compression method ${method} is not supported.`);
    if (localOffset + 30 > centralOffset || zip.readUInt32LE(localOffset) !== ZIP_LOCAL)
      throw new Error('Invalid ZIP local file header.');
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const localName = zip
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (localName !== rawName)
      throw new Error('ZIP entry name does not match its local file header.');
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new Error('Truncated or overlapping ZIP entry.');
    total += size;
    if (total > maxExpandedBytes)
      throw new Error(`Extracted website exceeds the ${maxExpandedBytes}-byte limit.`);
    const packed = zip.subarray(dataStart, dataEnd);
    let data: Buffer;
    try {
      data =
        method === 0
          ? Buffer.from(packed)
          : ((await inflateRawAsync(packed, {
              maxOutputLength: maxExpandedBytes - (total - size) + 1,
            })) as Buffer);
    } catch {
      throw new Error('ZIP entry is invalid or exceeds the extracted-size limit.');
    }
    if (data.byteLength !== size || crc32(data) !== crc)
      throw new Error('ZIP entry integrity check failed.');
    files.push({ name, data });
  }
  if (cursor !== centralOffset + centralSize)
    throw new Error('ZIP central directory length does not match.');
  return files;
}

function findEocd(zip: Buffer): number {
  const min = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - 22; offset >= min; offset--) {
    if (
      zip.readUInt32LE(offset) === ZIP_EOCD &&
      offset + 22 + zip.readUInt16LE(offset + 20) === zip.length
    )
      return offset;
  }
  throw new Error('Invalid ZIP archive.');
}

async function extractTar(
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
  const maxTarBytes = maxBytes + 10_000 * 2048 + 1024 * 1024;
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
      if (++entries > 10_000) throw new Error('TAR archive exceeds the 10000-entry limit.');
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
