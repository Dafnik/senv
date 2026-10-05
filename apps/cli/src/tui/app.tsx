import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { TuiController } from './controller.ts';
import { clip, safeText, terminalText, wrapLines } from './safety.ts';
import type { Modal } from './types.ts';
import { type DetailLine, type Tone } from './detail-layout.ts';
import { activeTabs, destination, projectScreens, tabLabel, visibleTabs } from './navigation.ts';
import { detailViewport } from './viewport.ts';

const noColor = process.env['NO_COLOR'] !== undefined || process.env['TERM'] === 'dumb';
const accent = noColor ? undefined : 'cyan';
const toneColors: Partial<Record<Tone, string>> = {
  accent: 'cyan',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
};
function DetailLineView({ line }: { line: DetailLine }) {
  if (!line.spans.some((span) => span.text.length)) return <Text> </Text>;
  return (
    <Text>
      {line.spans.map((span, index) => (
        <Text
          key={index}
          color={noColor ? undefined : toneColors[span.tone ?? 'normal']}
          dimColor={span.tone === 'muted'}
          bold={span.bold}
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}
const border =
  process.env['SENV_ASCII'] === '1' || process.env['LANG'] === 'C' ? 'classic' : 'single';
function ModalView({
  modal,
  width,
  height,
  scroll,
  target,
  now,
}: {
  modal: Modal;
  width: number;
  height: number;
  scroll: number;
  target: string;
  now: number;
}) {
  let lines: string[] = [];
  let footer = 'Enter or Esc closes';
  let start = scroll;
  if (modal.kind === 'menu') {
    const size = Math.max(1, height - 6);
    start = Math.max(0, modal.index - size + 1);
    lines = modal.actions.map(
      (action, index) =>
        `${index === modal.index ? '> ' : '  '}${action.label}${action.disabled ? ` [${action.disabled}]` : ''}`,
    );
    footer = 'Arrows select | Enter runs | Esc closes';
  } else if (modal.kind === 'form') {
    const size = Math.max(1, height - 7);
    start = Math.max(0, modal.index - size + 1);
    lines = modal.fields.map(
      (field, index) =>
        `${index === modal.index ? '> ' : '  '}${field.label}${field.required ? ' *' : ''}: ${field.value}${!modal.review && index === modal.index && !field.choices ? '_' : ''}${field.choices && !modal.review ? '  [Left/Right]' : ''}`,
    );
    footer = modal.review
      ? 'Review target and inputs | Enter submits | Esc edits'
      : 'Tab next field | Ctrl-U clears | Enter reviews | Esc discards';
  } else if (modal.kind === 'confirm') {
    lines = [
      ...modal.lines,
      '',
      `${modal.index === 0 ? '> ' : '  '}Cancel`,
      `${modal.index === 1 ? '> ' : '  '}Confirm`,
    ];
    footer = 'Left/Right selects | Enter activates | Esc cancels';
  } else if (modal.kind === 'message') {
    lines = wrapLines(modal.lines, width - 6);
    footer = 'Arrows scroll | Enter or Esc closes';
  } else {
    lines = wrapLines(
      [
        modal.url,
        `Code: ${modal.code}`,
        `Expires in ${Math.max(0, Math.ceil((modal.expiresAt - now) / 1000))} seconds: ${new Date(modal.expiresAt).toISOString()}`,
        'Waiting for explicit browser approval.',
        'Use this URL and code if the browser did not open.',
      ],
      width - 6,
    );
    footer = 'Esc or Ctrl-C cancels polling';
  }
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle={border}
      borderColor={accent}
      paddingX={1}
      overflow="hidden"
    >
      <Text bold color={accent}>
        {clip(modal.title + (modal.kind === 'form' && modal.review ? ' | Review' : ''), width - 6)}
      </Text>
      {modal.kind === 'form' && <Text dimColor>{clip(target, width - 6)}</Text>}
      {modal.kind === 'form' &&
        modal.review &&
        modal.notice?.map((line, index) => (
          <Text key={index}>{clip(safeText(line), width - 6)}</Text>
        ))}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {lines
          .slice(
            Math.min(start, Math.max(0, lines.length - 1)),
            Math.min(start, Math.max(0, lines.length - 1)) + Math.max(1, height - 6),
          )
          .map((line, index) => (
            <Text key={index}>
              {clip(
                modal.kind === 'message' && modal.secret ? terminalText(line) : safeText(line),
                width - 6,
              )}
            </Text>
          ))}
      </Box>
      {modal.kind === 'form' && (modal.error || modal.changed) && (
        <Text color={noColor ? undefined : 'yellow'}>
          {clip(modal.error ?? 'Saved identity changed. Review again.', width - 6)}
        </Text>
      )}
      <Text dimColor>{clip(footer, width - 6)}</Text>
    </Box>
  );
}
export function TuiApp({ controller }: { controller: TuiController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [now, setNow] = useState(Date.now());
  const pendingG = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.modal?.kind !== 'login') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.modal?.kind]);
  const { columns, rows } = useWindowSize();
  const { suspendTerminal } = useApp();
  useEffect(() => {
    controller.suspendTerminal = suspendTerminal;
  }, [controller, suspendTerminal]);
  const bodyHeight = Math.max(1, rows - (columns >= 90 ? 3 : 4));
  const viewport = detailViewport(state, columns, rows);
  const detailLayout = viewport.lines;
  useEffect(() => {
    controller.setViewport(columns, rows);
  }, [controller, columns, rows]);
  useInput(
    (input, key) => {
      const previousG = pendingG.current;
      pendingG.current = undefined;
      if (state.suspended) return;
      if (key.ctrl && input === 'z' && process.platform !== 'win32') {
        process.kill(process.pid, 'SIGTSTP');
        return;
      }
      if (key.ctrl && input === 'c') {
        if (state.busy) controller.cancel();
        else controller.requestQuit(130);
        return;
      }
      if (state.busy) {
        if (key.escape) controller.cancel();
        return;
      }
      const modal = state.modal;
      if (modal) {
        if (key.escape) {
          controller.back();
          return;
        }
        if (key.return || input === '\n') {
          controller.modalActivate();
          return;
        }
        if (modal.kind === 'form' && !modal.review) {
          if (key.tab || key.upArrow || key.downArrow)
            controller.modalMove(key.shift || key.upArrow ? -1 : 1);
          else if (key.leftArrow || key.rightArrow)
            controller.editField('', false, key.leftArrow ? -1 : 1);
          else if (key.ctrl && input === 'u') controller.editField('', false, 0, true);
          else if (key.backspace || key.delete) controller.editField('', true);
          else if (!key.ctrl && !key.meta) controller.editField(input);
          return;
        }
        const vim = !key.ctrl && !key.meta;
        const up = key.upArrow || (vim && input === 'k');
        const down = key.downArrow || (vim && input === 'j');
        const left = key.leftArrow || (vim && input === 'h');
        const right = key.rightArrow || (vim && input === 'l');
        if (up || down || left || right || key.tab) {
          if (modal.kind === 'message' || modal.kind === 'login')
            controller.setScroll(state.scroll + (up || left || key.shift ? -1 : 1));
          else controller.modalMove(up || left || key.shift ? -1 : 1);
        }
        return;
      }
      if (state.searching) {
        if (key.return || input === '\n') controller.finishSearch();
        else if (key.escape) controller.back();
        else if (key.ctrl && input === 'u') controller.search('');
        else if (key.backspace || key.delete)
          controller.search(Array.from(state.query).slice(0, -1).join(''));
        else if (!key.ctrl && !key.meta) controller.search(state.query + input);
        return;
      }
      const vim = !key.ctrl && !key.meta;
      // Terminals may buffer repeated printable keys into a single input event.
      if (vim && input.length > 1 && /^[jk]+$/.test(input)) {
        for (const motion of input) controller.move(motion === 'k' ? -1 : 1);
        return;
      }
      if (vim && (input === 'g' || input === 'gg')) {
        if (input === 'gg' || (previousG !== undefined && Date.now() - previousG < 1000))
          controller.jump(false);
        else pendingG.current = Date.now();
        return;
      }
      if (vim && input === 'G') {
        controller.jump(true);
        return;
      }
      const up = key.upArrow || (vim && input === 'k');
      const down = key.downArrow || (vim && input === 'j');
      const left = key.leftArrow || (vim && input === 'h');
      const right = key.rightArrow || (vim && input === 'l');
      if (key.tab) controller.toggleFocus(key.shift);
      else if (key.escape) controller.back();
      else if (key.return || input === '\n') void controller.activate();
      else if (up || down) controller.move(up ? -1 : 1);
      else if (key.pageUp || key.pageDown)
        controller.move((key.pageUp ? -1 : 1) * Math.max(1, bodyHeight - 4));
      else if (key.home) controller.jump(false);
      else if (key.end) controller.jump(true);
      else if (left || right) void controller.tab(left ? -1 : 1);
      else if (input === '[' || input === ']') void controller.page(input === '[' ? -1 : 1);
      else if (input === 'a') controller.actions();
      else if (input === '/') controller.beginSearch();
      else if (input === '?') controller.help();
      else if (input === 'r')
        void (state.account === 'signed out' ? controller.start() : controller.refresh());
      else if (input === 'i') controller.navigate('Instances');
      else if (input === 'p') controller.navigate('Projects');
      else if (input === 'q') controller.requestQuit();
    },
    { isActive: true },
  );
  if (columns < 40 || rows < 10)
    return (
      <Box flexDirection="column">
        <Text>Resize to at least 40 columns and 10 rows.</Text>
        <Text>q quits. Drafts are preserved.</Text>
      </Box>
    );
  const wide = columns >= 90;
  const navWidth = wide ? 20 : 0;
  const contentWidth = columns - navWidth;
  const tabs = activeTabs(state);
  const activeTab = state.detail && state.screen === 'Deployments' ? state.tab : state.screen;
  const tabStrip = visibleTabs(tabs, activeTab, contentWidth - 4);
  const currentDestination = destination(state.screen);
  const selectedDestination = state.navigation[state.navIndex] ?? currentDestination;
  const compactNavigation = visibleTabs(state.navigation, currentDestination, columns);
  const projectView = projectScreens.includes(state.screen);
  const contentHeight = viewport.height;
  const visible = controller.visibleRows();
  const listSize = Math.max(1, Math.floor(contentHeight / 2));
  const first = Math.max(0, state.selected - listSize + 1);
  const detailStart = viewport.start;
  const breadcrumb = projectView
    ? state.projectId
      ? `Projects / ${safeText(state.project)}${state.detail ? ` / ${state.screen}` : ''}`
      : 'Projects / Invitations'
    : currentDestination;
  const summary =
    state.searching || state.query
      ? `Search${!['Deployments', 'History', 'Invitations'].includes(state.screen) ? ' loaded rows' : ''}: ${state.query}${state.searching ? '_' : ''}`
      : state.detail
        ? state.screen === 'Deployments' && state.tab === 'Logs'
          ? `${state.source === 'origin' ? 'Origin' : 'Proxy'} logs (UTC) | ${state.follow ? 'following' : 'paused'} | ${state.autoScroll ? 'latest' : 'scroll paused'}`
          : state.screen === 'Deployments' && state.tab === 'Resources'
            ? `${state.detail.title} | ${state.watch ? 'watching' : 'paused'}`
            : state.detail.subtitle || state.detail.title
        : `${tabs.length ? tabLabel(state.screen) : state.screen} | ${visible.length} ${state.screen === 'Projects' ? (visible.length === 1 ? 'project' : 'projects') : visible.length === 1 ? 'entry' : 'entries'} | page ${state.page + 1}${state.hasNext ? ' | ] next' : ''}`;
  const hint =
    columns < 70
      ? state.focus === 'navigation'
        ? 'Up/Down select | Enter opens | Tab focus'
        : state.focus === 'tabs'
          ? 'Left/Right tabs | Enter content | ? help'
          : 'a actions | Tab focus | ? help | q quit'
      : state.focus === 'navigation'
        ? 'Tab focus | Arrows select | Enter opens | p projects | i instances | ? help | q quit'
        : state.focus === 'tabs'
          ? 'Left/Right tabs | Enter content | Tab focus | Esc back | a actions | ? help | q quit'
          : state.detail
            ? 'hjkl navigate | gg/G top/bottom | a actions | / search | Esc back | ? help | q quit'
            : `a actions | ${tabs.length ? 'Left/Right tabs | ' : ''}Enter opens | Esc back | / search | Tab focus | ? help | q quit`;
  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <Text>
        <Text bold color={accent}>
          senv
        </Text>
        {clip(
          `  /  ${state.instance || 'choose instance'}  /  ${safeText(state.account)}`,
          columns - 4,
        )}
      </Text>
      {!wide && (
        <Text>
          {state.focus === 'navigation' ? (
            <Text bold color={accent}>
              {clip(`Navigate: [ ${selectedDestination} ]  Up/Down selects`, columns)}
            </Text>
          ) : (
            <>
              {compactNavigation.before && <Text dimColor>... </Text>}
              {compactNavigation.tabs.map((item) => (
                <Text
                  key={item}
                  bold={item === currentDestination}
                  color={item === currentDestination ? accent : undefined}
                  dimColor={item !== currentDestination}
                >
                  {item === currentDestination ? `[${item}] ` : `${item} `}
                </Text>
              ))}
              {compactNavigation.after && <Text dimColor> ...</Text>}
            </>
          )}
        </Text>
      )}
      {state.modal ? (
        <ModalView
          modal={state.modal}
          width={columns}
          height={bodyHeight}
          scroll={state.scroll}
          now={now}
          target={`Instance: ${state.instance} | Project: ${state.project} (${state.projectId ?? '-'})`}
        />
      ) : (
        <Box height={bodyHeight}>
          {wide && (
            <Box
              width={navWidth}
              flexDirection="column"
              borderStyle={border}
              borderColor={state.focus === 'navigation' ? accent : undefined}
              paddingX={1}
              overflow="hidden"
            >
              <Text bold dimColor={state.focus !== 'navigation'}>
                Workspace
              </Text>
              <Text> </Text>
              {state.navigation.map((item, index) => (
                <Text
                  key={item}
                  bold={item === currentDestination}
                  color={item === currentDestination ? accent : undefined}
                >
                  {clip(
                    `${state.focus === 'navigation' && state.navIndex === index ? '> ' : item === currentDestination ? '* ' : '  '}${item}`,
                    navWidth - 4,
                  )}
                </Text>
              ))}
              <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
                {state.projectId && (
                  <Text dimColor>{clip(`Project: ${safeText(state.project)}`, navWidth - 4)}</Text>
                )}
                <Text dimColor>p Projects</Text>
                <Text dimColor>i Instances</Text>
              </Box>
            </Box>
          )}
          <Box
            width={contentWidth}
            flexDirection="column"
            borderStyle={border}
            borderColor={state.focus === 'content' || state.focus === 'tabs' ? accent : undefined}
            paddingX={1}
            overflow="hidden"
          >
            <Text bold>{clip(breadcrumb, contentWidth - 4)}</Text>
            {tabs.length > 0 && (
              <Text>
                {tabStrip.before && <Text dimColor>... </Text>}
                {tabStrip.tabs.map((tab, index) => (
                  <Text key={tab}>
                    {index > 0 ? ' ' : ''}
                    <Text
                      bold={tab === activeTab}
                      color={tab === activeTab ? accent : undefined}
                      inverse={tab === activeTab && state.focus === 'tabs'}
                      dimColor={tab !== activeTab}
                    >
                      {tab === activeTab ? `[${tabLabel(tab)}]` : ` ${tabLabel(tab)} `}
                    </Text>
                  </Text>
                ))}
                {tabStrip.after && <Text dimColor> ...</Text>}
              </Text>
            )}
            <Box height={1}>
              <Box flexGrow={1} overflow="hidden">
                <Text dimColor={!state.searching} color={state.searching ? accent : undefined}>
                  {clip(summary, contentWidth - 4 - (state.detail ? 13 : 0))}
                </Text>
              </Box>
              {state.detail && (
                <Text dimColor>
                  {detailLayout.length
                    ? `${detailStart + 1}-${Math.min(detailLayout.length, detailStart + contentHeight)}/${detailLayout.length}`
                    : ''}
                </Text>
              )}
            </Box>
            <Box flexDirection="column" height={contentHeight} overflow="hidden">
              {state.detail ? (
                detailLayout.length ? (
                  detailLayout
                    .slice(detailStart, detailStart + contentHeight)
                    .map((line, index) => <DetailLineView key={index} line={line} />)
                ) : (
                  <Text dimColor>{state.loading ? 'Loading...' : 'No entries.'}</Text>
                )
              ) : (
                <>
                  {visible.slice(first, first + listSize).map((item, index) => (
                    <Box key={item.id} flexDirection="column">
                      <Text
                        color={state.selected === first + index ? accent : undefined}
                        bold={state.selected === first + index}
                      >
                        {clip(
                          `${state.selected === first + index ? '> ' : '  '}${item.title}`,
                          contentWidth - 4,
                        )}
                      </Text>
                      <Text dimColor>{clip(`  ${item.subtitle}`, contentWidth - 4)}</Text>
                    </Box>
                  ))}
                  {!visible.length && (
                    <Text dimColor>
                      {state.loading
                        ? 'Loading...'
                        : state.error
                          ? 'Press r to retry or Esc to return.'
                          : state.screen === 'Invitations'
                            ? 'Use a to look up an invitation ID or invite members.'
                            : state.account === 'signed out'
                              ? 'Use a to log in or i to select an instance.'
                              : state.query
                                ? 'No matches. Use / to change your search.'
                                : state.screen === 'Projects'
                                  ? 'No projects yet. Use a to create a project or look up an invitation.'
                                  : state.screen === 'Deployments'
                                    ? 'No deployments yet. Use a to publish a deployment.'
                                    : 'No entries in this view.'}
                    </Text>
                  )}
                </>
              )}
            </Box>
          </Box>
        </Box>
      )}
      <Text color={state.error ? (noColor ? undefined : 'yellow') : undefined}>
        {clip(
          `${state.submittedDeploymentId ? `Deployment ${state.submittedDeploymentId} | ` : ''}${state.error ?? state.status}${columns >= 90 && state.lastRefresh && !state.error ? ` | updated ${state.lastRefresh.slice(11, 19)} UTC` : ''}${columns < 70 && tabs.length && !state.modal ? ' | Left/Right tabs' : ''}`,
          columns,
        )}
      </Text>
      <Text dimColor>
        {clip(state.busy ? 'Working | Esc / Ctrl-C cancels local work' : hint, columns)}
      </Text>
    </Box>
  );
}
