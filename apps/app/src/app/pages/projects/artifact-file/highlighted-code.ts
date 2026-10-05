import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

// Only these grammars and two themes enter the build; each grammar loads on demand.
const languages = {
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  sass: () => import('@shikijs/langs/sass'),
  less: () => import('@shikijs/langs/less'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  xml: () => import('@shikijs/langs/xml'),
  markdown: () => import('@shikijs/langs/markdown'),
  mdx: () => import('@shikijs/langs/mdx'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  fish: () => import('@shikijs/langs/fish'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  php: () => import('@shikijs/langs/php'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  swift: () => import('@shikijs/langs/swift'),
  sql: () => import('@shikijs/langs/sql'),
  graphql: () => import('@shikijs/langs/graphql'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  ini: () => import('@shikijs/langs/ini'),
  properties: () => import('@shikijs/langs/properties'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  make: () => import('@shikijs/langs/make'),
};
let highlighter: ReturnType<typeof createHighlighterCore> | undefined;

export async function highlightCode(text: string, language: string) {
  const instance = await (highlighter ??= createHighlighterCore({
    themes: [
      import('@shikijs/themes/github-light'),
      import('@shikijs/themes/github-dark'),
    ],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  }));
  const loader = Object.hasOwn(languages, language)
    ? languages[language as keyof typeof languages]
    : undefined;
  if (loader) await instance.loadLanguage(loader);
  return instance.codeToTokensWithThemes(text, {
    lang: loader ? language : 'text',
    themes: { light: 'github-light', dark: 'github-dark' },
    tokenizeMaxLineLength: 10_000,
    tokenizeTimeLimit: 100,
  });
}
