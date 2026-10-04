import { StringDecoder } from 'node:string_decoder';

const MAX_LOG_FRAGMENT_CHARS = 8_000; // At most 32 KiB of UTF-8.
const MAX_LOG_BATCH_BYTES = 32 * 1024;
type LogFragment = {
  content: string;
  ending: string;
  index: number;
  timestamp?: string;
  recordId?: string;
};

/** Decodes Docker frames and appends bounded UTF-8 batches without changing line endings. */
export async function collectDockerLogs(
  stream: AsyncIterable<Uint8Array>,
  append: (content: string) => void,
  accept: (fragment: LogFragment) => boolean = () => true,
): Promise<void> {
  let batch: string[] = [];
  let batchBytes = 0;
  const flush = () => {
    if (batch.length) append(batch.join(''));
    batch = [];
    batchBytes = 0;
  };
  for await (const fragment of logFragments(stream)) {
    if (!accept(fragment)) continue;
    for (const part of [fragment.content, fragment.ending]) {
      if (!part) continue;
      const bytes = Buffer.byteLength(part);
      if (batchBytes + bytes > MAX_LOG_BATCH_BYTES) flush();
      batch.push(part);
      batchBytes += bytes;
    }
  }
  flush();
}

async function* logFragments(stream: AsyncIterable<Uint8Array>): AsyncGenerator<LogFragment> {
  let pending = '';
  let index = 0;
  let record: Pick<LogFragment, 'timestamp' | 'recordId'> | undefined;
  const occurrences = new Map<string, number>();
  const identifyRecord = () => {
    if (record) return record;
    const timestamp = pending.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)/)?.[1];
    if (!timestamp) return (record = {});
    const occurrence = occurrences.get(timestamp) ?? 0;
    occurrences.set(timestamp, occurrence + 1);
    return (record = { timestamp, recordId: `${timestamp}:${occurrence}` });
  };
  for await (const chunk of dockerStreamTextChunks(stream)) {
    pending += chunk;
    while (pending) {
      const newline = pending.indexOf('\n');
      if (newline >= 0 && newline < MAX_LOG_FRAGMENT_CHARS) {
        const crlf = newline > 0 && pending[newline - 1] === '\r';
        yield {
          ...identifyRecord(),
          content: pending.slice(0, crlf ? newline - 1 : newline),
          ending: crlf ? '\r\n' : '\n',
          index,
        };
        pending = pending.slice(newline + 1);
        index = 0;
        record = undefined;
      } else if (pending.length >= MAX_LOG_FRAGMENT_CHARS) {
        let content = takeUtf8Prefix(pending, MAX_LOG_FRAGMENT_CHARS);
        // Hold a possible CRLF pair together across chunk/fragment boundaries.
        if (content.endsWith('\r')) content = content.slice(0, -1);
        yield { ...identifyRecord(), content, ending: '', index: index++ };
        pending = pending.slice(content.length);
      } else break;
    }
  }
  if (pending) yield { ...identifyRecord(), content: pending, ending: '', index };
}

export function dockerStreamText(buffer: Buffer): string {
  // Docker's non-TTY stream multiplexing uses an 8-byte header per stdout/stderr frame.
  let offset = 0;
  const chunks: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const stream = buffer[offset];
    const length = buffer.readUInt32BE(offset + 4);
    if (length > buffer.length - offset - 8 || ![0, 1, 2].includes(stream ?? -1)) break;
    chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return (chunks.length ? Buffer.concat(chunks) : buffer).toString('utf8');
}

async function* dockerStreamTextChunks(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  let multiplexed: boolean | undefined;
  const rawDecoder = new StringDecoder('utf8');
  const frameDecoders = new Map<number, StringDecoder>();
  for await (const raw of stream) {
    pending = Buffer.concat([pending, Buffer.from(raw)]);
    if (multiplexed === undefined && pending.length >= 8) {
      multiplexed =
        [0, 1, 2].includes(pending[0] ?? -1) &&
        pending[1] === 0 &&
        pending[2] === 0 &&
        pending[3] === 0;
      if (!multiplexed) {
        yield* decodeDockerTextChunks(rawDecoder, pending);
        pending = Buffer.alloc(0);
      }
    }
    if (multiplexed === undefined) continue;
    if (!multiplexed) {
      if (pending.length) {
        yield* decodeDockerTextChunks(rawDecoder, pending);
        pending = Buffer.alloc(0);
      }
      continue;
    }
    while (pending.length >= 8) {
      const size = pending.readUInt32BE(4);
      if (size > 128 * 1024 * 1024) throw new Error('Docker log frame is too large.');
      if (pending.length < 8 + size) break;
      const channel = pending[0] ?? 1;
      let decoder = frameDecoders.get(channel);
      if (!decoder) {
        decoder = new StringDecoder('utf8');
        frameDecoders.set(channel, decoder);
      }
      yield* decodeDockerTextChunks(decoder, pending.subarray(8, 8 + size));
      pending = pending.subarray(8 + size);
    }
  }
  if (pending.length) {
    if (multiplexed) throw new Error('Docker log stream ended inside a multiplex frame.');
    yield* decodeDockerTextChunks(rawDecoder, pending);
  }
  for (const decoder of multiplexed ? frameDecoders.values() : [rawDecoder]) {
    const final = decoder.end();
    if (final) yield final;
  }
}

function* decodeDockerTextChunks(decoder: StringDecoder, buffer: Buffer): Generator<string> {
  const decoderChunkBytes = 32 * 1024;
  for (let offset = 0; offset < buffer.length; offset += decoderChunkBytes) {
    const decoded = decoder.write(
      buffer.subarray(offset, Math.min(buffer.length, offset + decoderChunkBytes)),
    );
    if (decoded) yield decoded;
  }
}

function takeUtf8Prefix(value: string, maxCodePoints: number): string {
  let end = Math.min(value.length, maxCodePoints);
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1] ?? '')) end--;
  return value.slice(0, end);
}
