// TAR supports every compression codec provided by the instance's Node runtime.
export const staticArchiveExtensions = [
  '.zip',
  '.tar',
  '.tgz',
  '.gz',
  '.gzip',
  '.br',
  '.zst',
  '.zstd',
  '.tzst',
  '.zz',
  '.zlib',
  '.deflate',
  '.deflate-raw',
] as const;
