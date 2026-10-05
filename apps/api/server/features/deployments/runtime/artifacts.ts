import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withArtifactStorageLock } from '../storage/storage-lock';
import { extractZipToDirectory } from './artifact-zip-stream';
import type { StagedUploadFile } from './artifact-multipart';
import {
  chmod,
  mkdir,
  mkdtemp,
  copyFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { staticArchiveExtensions } from '../../../../shared/deployments';
import { extractTar, extractZip } from './artifact-archives';
import { maxStaticArtifactEntries } from './artifact-limits';
import { safeRelativePath, stripSelectedDirectoryRoot } from './artifact-paths';
import type { ArtifactStoreOptions, StaticUploadFile, StoredArtifact } from './artifact-types';
export { withArtifactStorageLock } from '../storage/storage-lock';
export { safeRelativePath, stripSelectedDirectoryRoot } from './artifact-paths';
export type { ArtifactStoreOptions, StaticUploadFile, StoredArtifact } from './artifact-types';

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
    if (files.length > maxStaticArtifactEntries)
      throw new Error(`Website exceeds the ${maxStaticArtifactEntries}-file limit.`);
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

  /** Extract and hash without holding the reference/cleanup lock. Only commit is serialized. */
  async ingestStaged(
    files: StagedUploadFile[],
    register: (saved: StoredArtifact) => void,
  ): Promise<StoredArtifact> {
    const temp = await mkdtemp(join(this.options.root, 'tmp/upload-'));
    try {
      await chmod(temp, 0o755);
      let total = 0;
      if (files.length === 1 && files[0]!.field === 'file') {
        const file = files[0]!;
        const lower = file.name.toLowerCase();
        if (!file.size) throw new Error('Select a non-empty archive.');
        if (!staticArchiveExtensions.some((extension) => lower.endsWith(extension)))
          throw new Error('Select a ZIP or TAR archive with a supported compression format.');
        if (lower.endsWith('.zip'))
          total = await extractZipToDirectory(file.filename, temp, this.options.maxBytes);
        else
          await extractTar(
            createReadStream(file.filename),
            lower,
            this.options.maxBytes,
            async (name, entry, size) => {
              const target = join(temp, ...name.split('/'));
              await mkdir(dirname(target), { recursive: true, mode: 0o755 });
              await pipeline(
                Readable.from(entry),
                createWriteStream(target, { flags: 'wx', mode: 0o644 }),
              );
              total += size;
            },
          );
      } else {
        if (!files.length || files.some((file) => file.field !== 'files'))
          throw new Error('Upload one archive or a set of directory files.');
        const seen = new Set<string>();
        for (const file of stripSelectedDirectoryRoot(files)) {
          const name = safeRelativePath(file.name);
          if (seen.has(name)) throw new Error(`Duplicate website path: ${name}`);
          seen.add(name);
          total += file.size;
          if (total > this.options.maxBytes)
            throw new Error(`Extracted website exceeds the ${this.options.maxBytes}-byte limit.`);
          const target = join(temp, ...name.split('/'));
          await mkdir(dirname(target), { recursive: true, mode: 0o755 });
          await copyFile(file.filename, target);
          await chmod(target, 0o644);
        }
      }
      return await this.#commit(temp, total, register);
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
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

  async #commit(
    temp: string,
    total: number,
    register?: (saved: StoredArtifact) => void,
  ): Promise<StoredArtifact> {
    const index = join(temp, 'index.html');
    if (!(await stat(index).catch(() => null))?.isFile())
      throw new Error('Website root must contain index.html.');
    const digest = createHash('sha256');
    // Hash a deterministic stream of paths and bytes so identical trees share storage.
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
          const filename = join(dir, entry.name);
          digest.update(uint64((await stat(filename)).size));
          for await (const bytes of createReadStream(filename)) digest.update(bytes);
        }
      }
    };
    await visit(temp);
    const sha256 = digest.digest('hex');
    const saved = { storageKey: sha256, size: total, sha256 };
    const commit = async () => {
      const destination = join(this.options.root, 'artifacts', sha256);
      await mkdir(dirname(destination), { recursive: true, mode: 0o750 });
      try {
        await rename(temp, destination);
      } catch (error) {
        if (!(await this.exists(sha256))) throw error;
        await rm(temp, { recursive: true, force: true });
      }
      register?.(saved);
      return saved;
    };
    return register ? withArtifactStorageLock(this.options.root, commit) : commit();
  }
}

function uint64(value: number): Buffer {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}
