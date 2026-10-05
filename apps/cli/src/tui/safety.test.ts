import { expect, test } from 'vite-plus/test';
import { clip, detailLines, safeText, terminalText, wrapLines } from './safety.ts';
import { assertTuiOptions } from './options.ts';
import stringWidth from 'string-width';
test('untrusted text cannot inject terminal controls or bidi overrides, and known credentials are redacted', () => {
  const unsafe =
    '\x1b]52;c;c2VjcmV0\x07\x1b[2Jname\b\r\u202e token=senv_at_abc bearer=personal-token';
  const result = safeText(unsafe, ['personal-token']);
  // Intentional assertion that terminal controls have been removed.
  // eslint-disable-next-line no-control-regex
  expect(result).not.toMatch(/[\x00-\x1f\u202e]/);
  expect(result).toContain('name token=[redacted] bearer=[redacted]');
  expect(detailLines({ config: { env: 'secret' }, password: 'secret', id: 'safe' })).toEqual([
    'id: safe',
  ]);
  expect(terminalText('hello\nworld')).toBe('hello\nworld');
});
test('clipping and wrapping respect grapheme width rather than UTF-16 length', () => {
  const input = '文档 👩‍💻 café';
  for (const width of [1, 2, 4, 8, 10])
    expect(stringWidth(clip(input, width))).toBeLessThanOrEqual(width);
  expect(wrapLines([input], 5).every((line) => stringWidth(line) <= 5)).toBe(true);
});
test('TUI requires both TTYs and rejects automation flags', () => {
  const tty = { stdin: true, stdout: true, term: 'xterm-256color' };
  for (const options of [{ yes: true }, { json: true }, { nonInteractive: true }])
    expect(() => assertTuiOptions(options, tty)).toThrow('ordinary senv commands');
  expect(() => assertTuiOptions({}, { ...tty, stdin: false })).toThrow('interactive terminal');
  expect(() => assertTuiOptions({}, { ...tty, stdout: false })).toThrow('interactive terminal');
  expect(() => assertTuiOptions({}, { ...tty, term: 'dumb' })).toThrow('interactive terminal');
  expect(() => assertTuiOptions({}, tty)).not.toThrow();
});
