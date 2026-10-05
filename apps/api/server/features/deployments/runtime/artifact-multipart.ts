import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import { maxStaticArtifactEntries } from './artifact-limits';

export type StagedUploadFile = { field: string; name: string; filename: string; size: number };

/** Keep request bodies off the heap and bound actual bytes, regardless of Content-Length. */
export async function stageArtifactUpload(request: Request, root: string, maxBytes: number) {
  const files: StagedUploadFile[] = [];
  const fields = new Map<string, string>();
  const writes: Promise<void>[] = [];
  let bytes = 0;
  let fileBytes = 0;
  const parser = busboy({
    headers: Object.fromEntries(request.headers),
    preservePath: true,
    defParamCharset: 'utf8',
    limits: {
      files: maxStaticArtifactEntries,
      fields: 3,
      parts: maxStaticArtifactEntries + 3,
      fieldSize: 16 * 1024,
      fileSize: maxBytes + 1,
    },
  });
  const directory = await mkdtemp(join(root, 'tmp/multipart-'));
  const fail = (message: string) => parser.destroy(new Error(message));
  parser.on('filesLimit', () => fail('Upload exceeds the file limit.'));
  parser.on('fieldsLimit', () => fail('Upload exceeds the metadata limit.'));
  parser.on('partsLimit', () => fail('Upload exceeds the multipart entry limit.'));
  parser.on('field', (name, value, info) => {
    if (
      info.valueTruncated ||
      info.nameTruncated ||
      fields.has(name) ||
      !['projectId', 'source', 'kind'].includes(name)
    ) {
      fail('Invalid upload metadata.');
      return;
    }
    fields.set(name, value);
  });
  parser.on('file', (field, stream, info) => {
    const file = {
      field,
      name: info.filename,
      filename: join(directory, String(files.length)),
      size: 0,
    };
    files.push(file);
    stream.on('limit', () => fail(`Upload exceeds the ${maxBytes}-byte limit.`));
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        file.size += chunk.length;
        fileBytes += chunk.length;
        callback(
          fileBytes > maxBytes ? new Error(`Upload exceeds the ${maxBytes}-byte limit.`) : null,
          chunk,
        );
      },
    });
    // Catch immediately so errors also stop the parser before it accepts more files.
    writes.push(
      pipeline(stream, bounded, createWriteStream(file.filename, { flags: 'wx', mode: 0o600 }), {
        signal: request.signal,
      }).catch((error) => {
        parser.destroy(error);
        throw error;
      }),
    );
    void writes.at(-1)!.catch(() => {});
  });
  try {
    if (!request.body) throw new Error('Upload contains no files.');
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > maxBytes + 8 * 1024 * 1024
            ? new Error(`Upload exceeds the ${maxBytes}-byte limit.`)
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>),
      bounded,
      parser,
      { signal: request.signal },
    );
    await Promise.all(writes);
    return { files, fields, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    parser.destroy();
    await Promise.allSettled(writes);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
