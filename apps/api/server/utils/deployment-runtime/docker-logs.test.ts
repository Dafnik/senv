import { Readable } from 'node:stream';
import { expect, test } from 'vite-plus/test';
import { collectDockerLogs } from './docker-logs';

function frame(content: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(content.length, 4);
  return Buffer.concat([header, content]);
}

test('preserves UTF-8 and line endings across Docker frames while bounding stored batches', async () => {
  const content = `${'💡'.repeat(20_000)}\r\n\n${'x'.repeat(7999)}\r\nlast line`;
  const bytes = Buffer.from(content);
  // Deliberately split an emoji between frames and split the frame headers between chunks.
  const stream = Buffer.concat([frame(bytes.subarray(0, 2)), frame(bytes.subarray(2))]);
  const batches: string[] = [];
  await collectDockerLogs(
    Readable.from([stream.subarray(0, 3), stream.subarray(3, 14), stream.subarray(14)]),
    (batch) => batches.push(batch),
  );
  expect(batches.join('')).toBe(content);
  expect(batches.length).toBeGreaterThan(2);
  expect(batches.every((batch) => Buffer.byteLength(batch) <= 32 * 1024)).toBe(true);
  expect(batches.join('')).not.toContain('\uFFFD');
});

test('polling can filter repeated fragments without changing the common parser', async () => {
  const batches: string[] = [];
  const seen = new Set<string>();
  const accept = ({ content, index }: { content: string; index: number }) => {
    const key = `${index}:${content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const append = (batch: string) => batches.push(batch);
  await collectDockerLogs(Readable.from([frame(Buffer.from('first\nsecond\n'))]), append, accept);
  await collectDockerLogs(Readable.from([frame(Buffer.from('second\nthird\n'))]), append, accept);
  expect(batches.join('')).toBe('first\nsecond\nthird\n');
});
