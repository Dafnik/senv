import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';

/** Creates a plain ustar archive for Docker's container archive endpoint. */
export async function writeTarFromDirectory(root: string, destination: string): Promise<void> {
  const output = createWriteStream(destination, { mode: 0o600 });
  try {
    const walk = async (directory: string, prefix = ''): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          await writeEntryHeader(output, `${relative}/`, 0, 0o755, '5');
          await walk(absolute, relative);
        } else if (entry.isFile()) {
          const info = await stat(absolute);
          await writeEntryHeader(output, relative, info.size, 0o644, '0');
          const input = (await import('node:fs')).createReadStream(absolute);
          for await (const chunk of input) await writeBuffer(output, Buffer.from(chunk));
          const padding = (512 - (info.size % 512)) % 512;
          if (padding) await writeBuffer(output, Buffer.alloc(padding));
        } else {
          throw new Error(`Cannot archive non-regular website entry: ${relative}`);
        }
      }
    };
    await walk(root);
    await writeBuffer(output, Buffer.alloc(1024));
    output.end();
    await once(output, 'close');
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function writeEntryHeader(
  output: NodeJS.WritableStream,
  path: string,
  size: number,
  mode: number,
  type: '0' | '5',
): Promise<void> {
  let archivePath = path;
  try {
    splitTarPath(path);
  } catch {
    const pax = paxPathRecord(path);
    await writeBuffer(output, header('PaxHeaders/senv', pax.length, 0o644, 'x'));
    await writeBuffer(output, pax);
    const padding = (512 - (pax.length % 512)) % 512;
    if (padding) await writeBuffer(output, Buffer.alloc(padding));
    archivePath = type === '5' ? 'PaxDir/' : 'PaxFile';
  }
  await writeBuffer(output, header(archivePath, size, mode, type));
}

function paxPathRecord(path: string): Buffer {
  const content = ` path=${path}\n`;
  let length = Buffer.byteLength(content) + 2;
  while (true) {
    const record = `${length}${content}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return Buffer.from(record, 'utf8');
    length = actual;
  }
}

function header(path: string, size: number, mode: number, type: '0' | '5' | 'x'): Buffer {
  const out = Buffer.alloc(512);
  const split = splitTarPath(path);
  writeString(out, 0, 100, split.name);
  writeOctal(out, 100, 8, mode);
  writeOctal(out, 108, 8, 0);
  writeOctal(out, 116, 8, 0);
  writeOctal(out, 124, 12, size);
  writeOctal(out, 136, 12, Math.floor(Date.now() / 1000));
  out.fill(0x20, 148, 156);
  out.write(type, 156, 'ascii');
  writeString(out, 257, 6, 'ustar\0');
  writeString(out, 263, 2, '00');
  writeString(out, 345, 155, split.prefix);
  let checksum = 0;
  for (const byte of out) checksum += byte;
  writeOctal(out, 148, 8, checksum);
  return out;
}
function splitTarPath(path: string): { name: string; prefix: string } {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
  if (Buffer.byteLength(normalized) <= 100) return { name: path, prefix: '' };
  const split = normalized.lastIndexOf('/');
  if (split < 0) throw new Error(`Website path is too long for Docker's archive format: ${path}`);
  const prefix = normalized.slice(0, split);
  const name = normalized.slice(split + 1);
  if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100)
    throw new Error(`Website path is too long for Docker's archive format: ${path}`);
  return { name, prefix };
}
function writeString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, length, 'utf8');
}
function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}
async function writeBuffer(stream: NodeJS.WritableStream, data: Buffer): Promise<void> {
  if (stream.write(data)) return;
  await once(stream, 'drain');
}
