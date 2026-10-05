import stringWidth from 'string-width';
import { clip, safeText, wrapLines } from './safety.ts';

export type Tone = 'normal' | 'muted' | 'accent' | 'success' | 'warning' | 'danger';
export type Fact = { label: string; value: string; tone?: Tone };
export type DetailBlock =
  | { kind: 'heading'; title: string; note?: string }
  | { kind: 'text'; text: string; tone?: Tone }
  | { kind: 'banner'; title: string; status: string; description: string; tone: Tone }
  | { kind: 'facts'; items: Fact[]; columns?: number }
  | {
      kind: 'meter';
      label: string;
      value: number;
      maximum: number | null;
      display: string;
      note?: string;
    }
  | { kind: 'trend'; label: string; values: Array<number | null>; summary: string }
  | { kind: 'table'; headings: string[]; rows: string[][] }
  | { kind: 'event'; title: string; at: string; actor: string; facts: Fact[]; tone: Tone }
  | { kind: 'log'; at: string; sequence: number; content: string; level?: string; tone?: Tone };
export type DetailSpan = { text: string; tone?: Tone; bold?: boolean };
export type DetailLine = { spans: DetailSpan[]; searchText?: string };
export const lineText = (line: DetailLine) => line.spans.map((span) => span.text).join('');

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const span = (text: string, tone: Tone = 'normal', bold = false): DetailSpan => ({
  text: safeText(text),
  tone,
  bold,
});
function padded(text: string, width: number) {
  const clipped = clip(safeText(text), width);
  return clipped + ' '.repeat(Math.max(0, width - stringWidth(clipped)));
}
function wrapped(text: string, width: number, tone: Tone = 'normal', indent = ''): DetailLine[] {
  return safeText(text)
    .split('\n')
    .flatMap((line) =>
      wrapLines([line], Math.max(1, width - indent.length)).map((part) => ({
        spans: [span(indent + part, tone)],
      })),
    );
}
function facts(items: Fact[], width: number, columns = 1): DetailLine[] {
  if (!items.length) return [];
  if (width < 48)
    return items.flatMap((item, index) => [
      ...(index ? [{ spans: [span('')] }] : []),
      ...wrapped(item.label, width, 'muted'),
      ...wrapped(item.value, width, item.tone),
    ]);
  if (columns > 1 && width >= 72) {
    const cellWidth = Math.floor((width - 4) / 2);
    const lines: DetailLine[] = [];
    for (let index = 0; index < items.length; index += 2) {
      const cells = items
        .slice(index, index + 2)
        .map((item) => [
          ...wrapped(item.label.toUpperCase(), cellWidth, 'muted'),
          ...wrapped(item.value, cellWidth, item.tone),
        ]);
      const height = Math.max(...cells.map((cell) => cell.length));
      for (let row = 0; row < height; row++) {
        const left = cells[0]![row];
        const right = cells[1]?.[row];
        lines.push({
          spans: [
            ...(left?.spans ?? [span('')]),
            span(' '.repeat(Math.max(0, cellWidth - stringWidth(left ? lineText(left) : '')) + 4)),
            ...(right?.spans ?? []),
          ],
        });
      }
      if (index + 2 < items.length) lines.push({ spans: [span('')] });
    }
    return lines;
  }
  const labelWidth = Math.min(
    20,
    Math.floor(width * 0.35),
    Math.max(...items.map((item) => stringWidth(item.label)), 0),
  );
  return items.flatMap((item) => {
    const labels = wrapped(item.label, labelWidth, 'muted');
    const values = wrapped(item.value, Math.max(1, width - labelWidth - 2), item.tone);
    return Array.from({ length: Math.max(labels.length, values.length) }, (_, index) => ({
      spans: [
        span(padded(labels[index] ? lineText(labels[index]!) : '', labelWidth) + '  ', 'muted'),
        ...(values[index]?.spans ?? []),
      ],
    }));
  });
}

function table(block: Extract<DetailBlock, { kind: 'table' }>, width: number): DetailLine[] {
  if (width < 60)
    return block.rows.flatMap((row) => [
      { spans: [span(row[0] ?? '', 'accent', true)] },
      ...facts(
        block.headings.slice(1).map((label, index) => ({ label, value: row[index + 1] ?? '-' })),
        width,
      ),
      { spans: [span('')] },
    ]);
  const gap = 2;
  const cellWidth = Math.floor((width - (block.headings.length - 1) * gap) / block.headings.length);
  const render = (values: string[], tone: Tone, bold = false): DetailLine[] => {
    const cells = values.map((value) => wrapLines([safeText(value)], cellWidth));
    return Array.from({ length: Math.max(1, ...cells.map((cell) => cell.length)) }, (_, row) => ({
      spans: [
        span(
          cells
            .map((cell) => padded(cell[row] ?? '', cellWidth))
            .join(' '.repeat(gap))
            .trimEnd(),
          tone,
          bold,
        ),
      ],
    }));
  };
  return [
    ...render(block.headings, 'muted', true),
    { spans: [span('-'.repeat(width), 'muted')] },
    ...block.rows.flatMap((row) => render(row, 'normal')),
  ];
}
function blockLines(block: DetailBlock, width: number): DetailLine[] {
  switch (block.kind) {
    case 'heading':
      return [
        {
          spans: [
            span(block.title.toUpperCase(), 'accent', true),
            span(' ' + '-'.repeat(Math.max(0, width - stringWidth(block.title) - 1)), 'muted'),
          ],
        },
        ...(block.note ? wrapped(block.note, width, 'muted') : []),
      ];
    case 'text':
      return wrapped(block.text, width, block.tone);
    case 'banner':
      return [
        {
          spans: [
            span(`[ ${safeText(block.status).toUpperCase()} ]`, block.tone, true),
            span('  ' + block.title, 'normal', true),
          ],
        },
        ...wrapped(block.description, width, 'muted'),
      ];
    case 'facts':
      return facts(block.items, width, block.columns);
    case 'meter': {
      const length = Math.max(8, Math.min(32, width - 12));
      const ratio =
        block.maximum && block.maximum > 0
          ? Math.max(0, Math.min(1, block.value / block.maximum))
          : null;
      const used = ratio === null ? 0 : Math.round(ratio * length);
      return [
        {
          spans: [
            span(block.label.toUpperCase(), 'muted'),
            span('  ' + block.display, 'normal', true),
          ],
        },
        ...(ratio === null
          ? []
          : [
              {
                spans: [
                  span('['),
                  span('#'.repeat(used), ratio >= 0.9 ? 'warning' : 'accent'),
                  span('-'.repeat(length - used), 'muted'),
                  span(']'),
                  span(`  ${((block.value / block.maximum!) * 100).toFixed(1)}%`, 'muted'),
                ],
              },
            ]),
        ...(block.note ? wrapped(block.note, width, 'muted') : []),
      ];
    }
    case 'trend': {
      const length = Math.min(60, width - 2);
      const available = block.values.filter(
        (value): value is number => value !== null && Number.isFinite(value),
      );
      const max = Math.max(1, ...available);
      const marks =
        process.env['SENV_ASCII'] === '1' || process.env['LANG'] === 'C'
          ? '._:-=+*#%@'
          : '▁▂▃▄▅▆▇█';
      const chart = Array.from({ length: Math.min(length, block.values.length) }, (_, index) => {
        const start = Math.floor(
          (index * block.values.length) / Math.min(length, block.values.length),
        );
        const end = Math.floor(
          ((index + 1) * block.values.length) / Math.min(length, block.values.length),
        );
        const bucket = block.values
          .slice(start, end)
          .filter((value): value is number => value !== null && Number.isFinite(value));
        return bucket.length
          ? marks[
              Math.round(Math.max(0, Math.min(1, Math.max(...bucket) / max)) * (marks.length - 1))
            ]!
          : ' ';
      }).join('');
      return [
        { spans: [span(block.label.toUpperCase(), 'muted'), span('  ' + block.summary)] },
        { spans: [span('|' + chart + '|', 'accent')] },
        { spans: [span('older' + ' '.repeat(Math.max(1, chart.length - 9)) + 'latest', 'muted')] },
      ];
    }
    case 'table':
      return table(block, width);
    case 'event':
      return [
        ...wrapped(block.at + '  /  ' + block.actor, width, 'muted'),
        ...wrapped('> ' + block.title, width, block.tone),
        ...facts(block.facts, width - 2).map((line) => ({ spans: [span('  '), ...line.spans] })),
      ];
    case 'log': {
      const prefix = `${block.at}  ${block.level ? block.level.padEnd(5) + ' ' : ''}`;
      const chunks = block.content.split('\n');
      return chunks.flatMap((chunk, index) =>
        wrapLines([safeText(chunk)], Math.max(1, width - prefix.length)).map(
          (part, continuation) => ({
            spans: [
              span(index === 0 && continuation === 0 ? prefix : ' '.repeat(prefix.length), 'muted'),
              span(part, block.tone),
            ],
            searchText: block.content,
          }),
        ),
      );
    }
  }
}

/** Layout is computed at the terminal width before scrolling, so long URLs and log lines remain reachable. */
export function layoutDetail(blocks: DetailBlock[], width: number, query = ''): DetailLine[] {
  const lines: DetailLine[] = [];
  let previous: DetailBlock | undefined;
  for (const block of blocks) {
    const content = blockLines(block, Math.max(24, width));
    const match = safeText(query).toLowerCase().trim();
    if (
      match &&
      !content.some((line) => (line.searchText ?? lineText(line)).toLowerCase().includes(match))
    )
      continue;
    if (lines.length && block.kind !== 'log' && previous?.kind !== 'heading')
      lines.push({ spans: [span('')] });
    lines.push(...content);
    previous = block;
  }
  // Banner labels and metric captions can be long. Wrap each span without losing its tone.
  return lines.flatMap((line) => {
    if (stringWidth(lineText(line)) <= width) return [line];
    const result: DetailLine[] = [];
    let current: DetailSpan[] = [];
    let used = 0;
    for (const part of line.spans) {
      for (const character of segmenter.segment(part.text)) {
        const size = stringWidth(character.segment);
        if (used + size > width && used) {
          result.push({ spans: current });
          current = [];
          used = 0;
        }
        if (size > width) continue;
        const previous = current.at(-1);
        if (previous && previous.tone === part.tone && previous.bold === part.bold)
          previous.text += character.segment;
        else current.push({ ...part, text: character.segment });
        used += size;
      }
    }
    result.push({ spans: current });
    return result;
  });
}
