import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

export function terminalText(value: unknown) {
  // Terminal text must not carry C0/C1 controls into Ink.
  return (
    stripVTControlCharacters(String(value ?? '').replaceAll('\t', '    '))
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
      .replace(/[\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '')
  );
}

export function safeText(value: unknown, secrets: string[] = []) {
  let text = terminalText(value).replace(/senv_at_[A-Za-z0-9_-]+/g, '[redacted]');
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]');
  return text;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function clip(value: string, width: number) {
  if (width <= 0) return '';
  const text = terminalText(value).replaceAll('\n', ' ');
  if (stringWidth(text) <= width) return text;
  let result = '';
  for (const { segment } of segmenter.segment(text)) {
    if (stringWidth(result + segment) > width - 1) break;
    result += segment;
  }
  return `${result}~`;
}

export function wrapLines(lines: string[], width: number) {
  const result: string[] = [];
  for (const line of lines) {
    let current = '';
    for (const { segment } of segmenter.segment(terminalText(line))) {
      if (current && stringWidth(current + segment) > Math.max(1, width)) {
        result.push(current);
        current = '';
      }
      current += segment;
    }
    result.push(current);
  }
  return result;
}

export function detailLines(value: unknown, depth = 0): string[] {
  if (value instanceof Date) return [value.toISOString()];
  if (value === null || value === undefined) return ['-'];
  if (depth > 4) return ['...'];
  if (Array.isArray(value)) return value.slice(0, 100).flatMap((v) => detailLines(v, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value)
      .slice(0, 100)
      .flatMap(([key, item]) => {
        if (/config|environment|^env$|password|secret|tokenHash|grant|credential/i.test(key))
          return [];
        const lines = detailLines(item, depth + 1);
        return lines.length === 1
          ? [`${safeText(key)}: ${lines[0]}`]
          : [`${safeText(key)}:`, ...lines.map((line) => `  ${line}`)];
      });
  }
  return safeText(value).slice(0, 16_384).split('\n');
}
