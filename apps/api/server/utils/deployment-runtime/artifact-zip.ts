import { crc32, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import type { StaticUploadFile } from './artifact-types';
import { safeRelativePath } from './artifact-paths';
import { maxStaticArtifactEntries } from './artifact-limits';

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const inflateRawAsync = promisify(inflateRaw);

export async function extractZip(
  zip: Buffer,
  maxExpandedBytes: number,
): Promise<StaticUploadFile[]> {
  const eocd = findEocd(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  if (entryCount > maxStaticArtifactEntries)
    throw new Error(`ZIP archive exceeds the ${maxStaticArtifactEntries}-entry limit.`);
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
