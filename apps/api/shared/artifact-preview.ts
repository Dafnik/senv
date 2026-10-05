/** Never infer executable inline content from an uploaded MIME type. */
const imageTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
};
const codeLanguages: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  md: 'markdown',
  mdx: 'mdx',
  txt: 'text',
  log: 'text',
  csv: 'text',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'fish',
  py: 'python',
  rb: 'ruby',
  php: 'php',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  ini: 'ini',
  conf: 'ini',
  properties: 'properties',
  diff: 'diff',
  patch: 'diff',
};
export const maxArtifactCodePreviewBytes = 256 * 1024;
export const maxArtifactImagePreviewBytes = 32 * 1024 * 1024;

export function artifactPreviewType(name: string) {
  const lower = name.toLowerCase();
  const extension = lower.split('.').at(-1) ?? '';
  if (imageTypes[extension])
    return { kind: 'image' as const, mime: imageTypes[extension]!, language: null };
  const language =
    lower === 'dockerfile'
      ? 'dockerfile'
      : lower === 'makefile'
        ? 'make'
        : /^\.(?:env(?:\..*)?|gitignore|dockerignore)$/.test(lower)
          ? 'shellscript'
          : /^(?:license|readme)$/.test(lower)
            ? 'text'
            : codeLanguages[extension];
  if (language) return { kind: 'code' as const, mime: 'text/plain', language };
  return { kind: 'download' as const, mime: 'application/octet-stream', language: null };
}
