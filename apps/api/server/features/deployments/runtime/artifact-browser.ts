import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { pack } from 'tar-stream';
import { ZipFile } from 'yazl';
import type { ArtifactEntry } from '../../../../shared/artifacts';
import {
  artifactPreviewType,
  maxArtifactCodePreviewBytes,
  maxArtifactImagePreviewBytes,
} from '../../../../shared/artifact-preview';
import { safeRelativePath } from './artifact-paths';
import { maxStaticArtifactEntries } from './artifact-limits';

export class ArtifactPathError extends Error {}
export class ArtifactMissingError extends Error {}

/** Only committed regular files and directories may be browsed or downloaded. */
export async function resolveArtifactPath(root: string, storageKey: string, path = '') {
  if (!/^[a-f0-9]{64}$/.test(storageKey)) throw new ArtifactPathError('Invalid artifact key.');
  let segments: string[];
  try {
    segments = path ? safeRelativePath(path).split('/') : [];
  } catch {
    throw new ArtifactPathError('Choose a valid artifact path.');
  }
  let target = join(root, 'artifacts', storageKey);
  let info = await lstat(target).catch(() => null);
  if (!info) throw new ArtifactMissingError('This artifact is no longer available.');
  if (!info.isDirectory()) throw new ArtifactPathError('Artifact root must be a directory.');
  for (const segment of segments) {
    if (!info.isDirectory()) throw new ArtifactMissingError('Artifact path not found.');
    target = join(target, segment);
    info = await lstat(target).catch(() => null);
    if (!info) throw new ArtifactMissingError('Artifact path not found.');
    if (!info.isDirectory() && !info.isFile())
      throw new ArtifactPathError('Artifact links and special files are not accessible.');
  }
  return { target, info };
}

async function scanDirectory(target: string, path: string, counter: { entries: number }) {
  const entries: ArtifactEntry[] = [];
  let size = 0;
  for (const name of await readdir(target)) {
    if (++counter.entries > maxStaticArtifactEntries * 2)
      throw new ArtifactPathError('Artifact contains too many entries.');
    const entryPath = path ? `${path}/${name}` : name;
    const child = join(target, name);
    const info = await lstat(child);
    if (!info.isFile() && !info.isDirectory())
      throw new ArtifactPathError('Artifact links and special files are not accessible.');
    const nested = info.isDirectory() ? await scanDirectory(child, entryPath, counter) : undefined;
    const bytes = nested?.size ?? info.size;
    size += bytes;
    entries.push({
      name,
      path: entryPath,
      kind: info.isDirectory() ? 'directory' : 'file',
      size: bytes,
    });
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1,
  );
  return { path, entries, size };
}

export async function browseArtifact(root: string, storageKey: string, path = '') {
  const { target, info } = await resolveArtifactPath(root, storageKey, path);
  if (!info.isDirectory()) throw new ArtifactPathError('Choose an artifact directory.');
  return scanDirectory(target, path, { entries: 0 });
}

export async function previewArtifactFile(root: string, storageKey: string, path: string) {
  const { stream, size } = await openArtifactFile(root, storageKey, path);
  const name = path.split('/').at(-1)!;
  const preview = artifactPreviewType(name);
  let text: string | null = null;
  let reason: string | null = null;
  try {
    if (preview.kind === 'code') {
      if (size > maxArtifactCodePreviewBytes)
        reason = 'This file is too large to preview. Download it to view its contents.';
      else {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > maxArtifactCodePreviewBytes)
            throw new ArtifactPathError('File exceeds the preview limit.');
          chunks.push(chunk);
        }
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          if (text.includes('\0')) text = null;
        } catch {
          text = null;
        }
        if (text === null)
          reason = 'This file is not UTF-8 text. Download it to view its contents.';
      }
    } else if (preview.kind === 'image' && size > maxArtifactImagePreviewBytes) {
      reason = 'This image is too large to preview. Download it to view its contents.';
    }
    return { name, path, size, ...preview, text, reason };
  } finally {
    stream.destroy();
  }
}

export async function openArtifactFile(root: string, storageKey: string, path: string) {
  const { target, info } = await resolveArtifactPath(root, storageKey, path);
  if (!info.isFile()) throw new ArtifactPathError('Choose a regular artifact file.');
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  return { stream: handle.createReadStream(), size: info.size };
}

async function artifactFiles(root: string, storageKey: string) {
  const files: ArtifactEntry[] = [];
  const pending = [''];
  let count = 0;
  while (pending.length) {
    const path = pending.pop()!;
    const { target } = await resolveArtifactPath(root, storageKey, path);
    for (const name of await readdir(target)) {
      if (++count > maxStaticArtifactEntries * 2)
        throw new ArtifactPathError('Artifact contains too many entries.');
      const entryPath = path ? `${path}/${name}` : name;
      const entry = await resolveArtifactPath(root, storageKey, entryPath);
      if (entry.info.isDirectory()) pending.push(entryPath);
      else files.push({ name, path: entryPath, kind: 'file', size: entry.info.size });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function downloadArtifactArchive(
  root: string,
  storageKey: string,
  format: 'zip' | 'tar.gz',
): Promise<Readable> {
  const files = await artifactFiles(root, storageKey);
  if (format === 'zip') {
    const zip = new ZipFile();
    const output = zip.outputStream as Readable;
    let active: Readable | undefined;
    zip.on('error', (error) => output.destroy(error));
    output.on('close', () => active?.destroy());
    for (const file of files) {
      zip.addReadStreamLazy(file.path, { size: file.size, mode: 0o100644 }, (callback) => {
        void openArtifactFile(root, storageKey, file.path).then(
          ({ stream }) => {
            active = stream;
            if (output.destroyed) {
              stream.destroy();
              return;
            }
            callback(null, stream);
          },
          (error) => callback(error, undefined as never),
        );
      });
    }
    zip.end();
    return output;
  }

  const tar = pack();
  const output = new PassThrough();
  void pipeline(tar, createGzip(), output).catch((error) => output.destroy(error));
  void (async () => {
    for (const file of files) {
      const { stream } = await openArtifactFile(root, storageKey, file.path);
      await pipeline(stream, tar.entry({ name: file.path, size: file.size, mode: 0o644 }));
    }
    tar.finalize();
  })().catch((error) => tar.destroy(error));
  return output;
}
