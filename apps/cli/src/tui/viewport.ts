import { layoutDetail, type DetailLine } from './detail-layout.ts';
import { activeTabs } from './navigation.ts';
import { safeText, wrapLines } from './safety.ts';
import type { Row, State } from './types.ts';

const layouts = new WeakMap<Row, Map<string, DetailLine[]>>();

export function detailViewport(state: State, columns: number, rows: number) {
  const width = Math.max(1, columns - (columns >= 90 ? 20 : 0) - 4);
  const height = Math.max(
    1,
    rows - (columns >= 90 ? 3 : 4) - 4 - (activeTabs(state).length ? 1 : 0),
  );
  const query = state.screen === 'Deployments' && state.tab === 'History' ? '' : state.query;
  const key = `${width}:${query}`;
  let lines: DetailLine[] = [];
  if (state.detail) {
    let cached = layouts.get(state.detail);
    if (!cached) {
      cached = new Map();
      layouts.set(state.detail, cached);
    }
    const stored = cached.get(key);
    if (stored) lines = stored;
    else {
      lines = state.detail.document
        ? layoutDetail(state.detail.document, width, query)
        : wrapLines(
            state.detail.lines.filter(
              (line) => !query || safeText(line).toLowerCase().includes(query.toLowerCase()),
            ),
            width,
          ).map((text) => ({ spans: [{ text }] }));
      if (cached.size >= 4) cached.clear();
      cached.set(key, lines);
    }
  }
  const maximum = Math.max(0, lines.length - height);
  const following = state.screen === 'Deployments' && state.tab === 'Logs' && state.autoScroll;
  const start = following ? maximum : Math.max(0, Math.min(state.scroll, maximum));
  return { lines, height, maximum, start };
}
