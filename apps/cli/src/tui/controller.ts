import { buildActions } from './actions/index.ts';
import { hostname } from 'node:os';
import { linkProject, nearestLink } from '../services/link.ts';

import open from 'open';
import {
  apiClient,
  authRequest,
  resolveContext,
  type ClientContext,
  type ContextOptions,
} from '../api/client.ts';
import { readConfiguration, validateApiUrl, writeConfiguration } from '../profiles.ts';
import { CliError, errorCode } from '../errors.ts';
import { login, logout } from '../services/auth.ts';
import { waitForPublication } from '../services/publication-wait.ts';
import { unknownOutcome } from '../errors.ts';
import { publish } from '../services/publication.ts';
import { runShell } from '../services/shell.ts';

import { detailLines, safeText, terminalText } from './safety.ts';
import { detailViewport } from './viewport.ts';
import { dateLabel, detailDocument, logsDocument } from './deployment-detail.ts';
import { destination, destinations, projectScreens, sectionTabs } from './navigation.ts';
import { deploymentTabs, type Field, type Row, type Screen, type State } from './types.ts';
import {
  loadDeployment,
  loadScreen,
  instanceRows,
  row,
  selectProject,
  type Access,
  type Identity,
  type LogEntry,
  type Project,
  type ProjectCursor,
  type User,
} from './workspace.ts';

const defaults = {
  apiClient,
  resolveContext,
  login,
  logout,
  publish,
  runShell,
  loadScreen,
  loadDeployment,
  selectProject,
  open,
  readConfiguration,
  writeConfiguration,
};
type Dependencies = typeof defaults;
type Task = (signal: AbortSignal) => Promise<void>;
export function initialState(): State {
  return {
    revision: 0,
    screen: 'Account',
    rows: [],
    selected: 0,
    query: '',
    searching: false,
    focus: 'content',
    navigation: ['Account', 'Instances'],
    screens: ['Account', 'Instances'],
    navIndex: 0,
    page: 0,
    hasNext: false,
    loading: false,
    busy: false,
    status: 'Connecting...',
    instance: '',
    account: 'signed out',
    project: 'select a project',
    tab: 'Overview',
    scroll: 0,
    follow: false,
    autoScroll: true,
    source: 'origin',
    watch: false,
    deploymentFilter: '',
    historyEvent: '',
    historyActor: '',
    suspended: false,
  };
}
export class TuiController {
  private state = initialState();
  private viewport = { columns: 100, rows: 24 };
  private listeners = new Set<() => void>();
  private deps: Dependencies;
  private context?: ClientContext;
  private identity?: Identity;
  private access?: Access;
  private project?: Project;
  private read?: AbortController;
  private operation?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private disposed = false;
  private cursors = new Map<number, ProjectCursor>();
  private formTask?: (values: Record<string, string>, signal: AbortSignal) => Promise<void>;
  private formMutation = true;
  private reviewNotice?: (values: Record<string, string>) => string[];
  private confirmation?: () => void;
  private afterDiscard?: () => void;
  private restoreDraft?: State['modal'];
  private logBacklog = false;
  private logs: LogEntry[] = [];
  private afterSequence?: number;
  private olderCursor?: { sequence: number } | null;
  private mutationSent = false;
  private identityValidatedAt = 0;
  private failures = 0;
  private secretLines: string[] = [];
  private deferredAccountFailure?: string;
  private previewTarget?: { projectId: string; deploymentId: string };
  private gapSequences = new Set<number>();
  revealLines() {
    return this.state.modal?.kind === 'message' && this.state.modal.secret ? this.secretLines : [];
  }
  private selectedDeployment?: Row;
  private profileHint?: { name: string; apiUrl: string };
  onQuit: (code: number) => void = () => {};
  suspendTerminal: (callback: () => Promise<void>) => Promise<void> = async (callback) =>
    callback();
  constructor(
    private options: ContextOptions = {},
    deps: Partial<Dependencies> = {},
  ) {
    this.deps = { ...defaults, ...deps };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<State>) {
    if (this.disposed) return;
    if (patch.modal !== undefined && !(patch.modal.kind === 'message' && patch.modal.secret))
      this.secretLines = [];
    if ('modal' in patch && !patch.modal) this.secretLines = [];
    const next = { ...this.state, ...patch, revision: this.state.revision + 1 };
    if (next.detail && !next.modal)
      next.scroll = detailViewport(next, this.viewport.columns, this.viewport.rows).start;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  private text(value: unknown) {
    return safeText(value, this.context?.token ? [this.context.token] : []);
  }
  private personal() {
    return this.access?.kind === 'personal' && !this.access.impersonated;
  }
  private manage() {
    return Boolean(this.project && ['manage', 'admin'].includes(this.project.permission));
  }
  private admin() {
    return this.personal() && this.project?.permission === 'admin';
  }

  private requireContext() {
    if (!this.context || !this.identity || !this.access) throw new CliError('Sign in first.', 3);
    return this.context;
  }
  private requestContext(signal?: AbortSignal) {
    const value = this.requireContext();
    return { ...value, client: this.deps.apiClient(value.profile.apiUrl, value.token, signal) };
  }
  private stopReads() {
    this.epoch++;
    this.read?.abort();
    this.read = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private allowedScreens(): Screen[] {
    if (!this.access) return ['Account', 'Instances'];
    if (this.access.kind === 'automation')
      return ['Projects', 'Deployments', 'History', 'Instances'];
    return [
      'Projects',
      'Deployments',
      'History',
      'Members',
      'Invitations',
      'Account',
      ...(this.personal() ? (['Sessions', 'Automation tokens'] as Screen[]) : []),
      ...(this.identity?.role === 'admin' ? (['Users', 'Instance statistics'] as Screen[]) : []),
      'Instances',
    ];
  }
  async start() {
    await this.connect();
  }
  private async connect() {
    this.stopReads();
    const epoch = this.epoch;
    const read = new AbortController();
    this.read = read;
    this.update({ loading: true, error: undefined, status: 'Connecting...' });
    try {
      const context = await this.deps.resolveContext(
        { ...this.options, signal: read.signal },
        false,
      );
      if (read.signal.aborted || epoch !== this.epoch) return;
      this.profileHint = { name: context.name, apiUrl: context.profile.apiUrl };
      this.update({ instance: context.name });
      if (!context.token) throw new CliError('Sign in to this instance.', 3);
      const [identity, access] = await Promise.all([
        context.client.me.query(),
        context.client.cli.access.query(),
      ]);
      const selection = this.options.project ?? process.env['SENV_PROJECT'];
      let project: Project | undefined;
      let selectionError: string | undefined;
      try {
        const target = selection ?? access.projectId ?? (await context.project());
        project = await this.deps.selectProject(context, target, identity, access);
      } catch (error) {
        if (![2, 4, 5].includes(errorCode(error))) throw error;
        selectionError = this.text(
          error instanceof Error ? error.message : 'Project selection failed.',
        );
      }
      if (epoch !== this.epoch || read.signal.aborted) return;
      // Keep context transport independent of a view's cancellation signal.
      this.context = {
        ...context,
        client: this.deps.apiClient(context.profile.apiUrl, context.token),
      };
      this.identity = identity;
      this.access = access;
      this.identityValidatedAt = Date.now();
      this.project = project;
      const screen: Screen = project ? 'Deployments' : 'Projects';
      this.update({
        instance: context.name,
        account:
          access.kind === 'automation' ? `automation (${access.permission})` : identity.email,
        project: project?.name ?? 'select a project',
        projectId: project?.id,
        navigation: destinations(this.allowedScreens()),
        screens: this.allowedScreens(),
        navIndex: 0,
        focus: 'content',
        screen,
        rows: [],
        detail: undefined,
        modal: undefined,
        loading: false,
        status: selectionError ? `${selectionError} Select a project in Projects.` : 'Connected',
        page: 0,
      });
      await this.refresh(false);
    } catch (error) {
      if (epoch !== this.epoch || read.signal.aborted) return;
      const message = this.text(error instanceof Error ? error.message : 'Could not connect.');
      this.clearAccount(message);
      await this.showInstances();
      this.navigate('Account');
      if (!process.env['SENV_TOKEN'] && [2, 3].includes(errorCode(error))) this.loginForm();
      this.update({ error: message });
    }
  }
  private clearAccount(message: string) {
    this.stopReads();
    if (this.state.modal?.kind === 'message' && this.state.modal.secret) {
      this.deferredAccountFailure = message;
      this.update({ error: message, status: 'Save the displayed token before closing this view.' });
      return;
    }
    this.secretLines = [];
    this.identityValidatedAt = 0;
    this.afterSequence = undefined;
    this.olderCursor = undefined;
    this.gapSequences.clear();
    this.cursors.clear();
    this.context = undefined;
    this.identity = undefined;
    this.access = undefined;
    this.project = undefined;
    this.selectedDeployment = undefined;
    this.logs = [];
    this.gapSequences.clear();
    this.formTask = undefined;
    this.reviewNotice = undefined;
    this.restoreDraft = undefined;
    this.afterDiscard = undefined;
    this.confirmation = undefined;
    this.update({
      query: '',
      searching: false,
      tab: 'Overview',
      page: 0,
      selected: 0,
      scroll: 0,
      source: 'origin',
      deploymentFilter: '',
      historyEvent: '',
      historyActor: '',
      account: 'signed out',
      project: 'select a project',
      projectId: undefined,
      submittedDeploymentId: undefined,
      navigation: ['Account', 'Instances'],
      screens: ['Account', 'Instances'],
      screen: 'Account',
      focus: 'content',
      navIndex: 0,
      rows: [],
      detail: undefined,
      modal: undefined,
      loading: false,
      error: message,
      lastRefresh: undefined,
      follow: false,
      watch: false,
    });
  }
  dispose() {
    this.secretLines = [];
    this.deferredAccountFailure = undefined;
    this.stopReads();
    this.operation?.abort();
    this.formTask = undefined;
    this.reviewNotice = undefined;
    this.restoreDraft = undefined;
    this.afterDiscard = undefined;
    this.confirmation = undefined;
    this.logs = [];
    this.gapSequences.clear();
    this.context = undefined;
    this.state = { ...initialState(), status: 'Closed' };
    this.disposed = true;
    this.listeners.clear();
  }
  pause() {
    this.stopReads();
  }
  resume() {
    if (!this.state.suspended) void this.refresh();
  }
  private schedule(failed = false) {
    clearTimeout(this.timer);
    if (
      this.disposed ||
      this.state.busy ||
      this.state.suspended ||
      this.state.modal?.kind === 'login'
    )
      return;
    const liveLogs = this.state.detail && this.state.tab === 'Logs' && this.state.follow;
    const resources = this.state.detail && this.state.tab === 'Resources' && this.state.watch;
    this.failures = failed ? this.failures + 1 : 0;
    const interval = failed
      ? Math.min(1000 * 2 ** (this.failures - 1), 30_000)
      : liveLogs
        ? this.logBacklog
          ? 0
          : 1000
        : resources
          ? 5000
          : 30_000;
    if (this.context)
      this.timer = setTimeout(() => {
        void this.refresh(false);
      }, interval);
  }
  async refresh(revalidate = true) {
    if (this.disposed || this.state.busy || this.state.suspended) return;
    if (!this.context) {
      if (this.state.screen === 'Instances') await this.showInstances();
      else
        this.update({
          loading: false,
          status: 'Signed out. Open Account actions to log in or retry the connection.',
        });
      return;
    }
    this.stopReads();
    const epoch = this.epoch;
    const read = new AbortController();
    this.read = read;
    const state = this.state;
    const value = this.requestContext(read.signal);
    this.update({ loading: true });
    try {
      let identity = this.identity!;
      let access = this.access!;
      let project = this.project;
      if (revalidate || Date.now() - this.identityValidatedAt >= 30_000) {
        [identity, access] = await Promise.all([
          value.client.me.query(),
          value.client.cli.access.query(),
        ]);
        if (project) project = await this.deps.selectProject(value, project.id, identity, access);
        this.identityValidatedAt = Date.now();
      }
      if (epoch !== this.epoch || read.signal.aborted) return;
      this.identity = identity;
      this.access = access;
      if (epoch !== this.epoch || read.signal.aborted) return;
      const allowed = this.allowedScreens();
      if (!allowed.includes(state.screen)) {
        this.update({ navigation: destinations(allowed), screens: allowed });
        this.navigate('Projects');
        return;
      }
      const needed =
        (projectScreens.includes(state.screen) && state.screen !== 'Invitations') ||
        Boolean(state.detail && this.selectedDeployment);
      if (needed && !project) {
        this.update({
          rows: [],
          detail: undefined,
          loading: false,
          status: 'Select a project in Projects.',
        });
        return;
      }
      if (this.previewTarget) {
        const preview = await value.client.deployments.previewStatus.query(this.previewTarget);
        if (epoch !== this.epoch || read.signal.aborted) return;
        this.message('Public preview status (r refreshes)', [
          preview.error ?? `HTTP ${preview.statusCode} response in ${preview.responseTimeMs} ms`,
          preview.url,
          `Checked ${dateLabel(preview.checkedAt)}`,
        ]);
      }
      let detail = state.detail;
      let page;
      if (detail && this.selectedDeployment) {
        if (state.tab === 'Logs') detail = await this.loadLogs(value, read.signal);
        else
          detail = await this.deps.loadDeployment(
            value,
            project!.id,
            detail.id,
            state.tab,
            {
              source: state.source,
              historyEvent: state.historyEvent,
              historyActor: state.historyActor,
              query: state.query,
            },
            detail,
          );
      } else if (!detail) {
        page = await this.deps.loadScreen(
          value,
          state.screen,
          {
            page: state.page,
            cursor: this.cursors.get(state.page),
            projectId: project?.id,
            project,
            identity,
            access,
            query: state.query,
            deploymentFilter: state.deploymentFilter,
            historyEvent: state.historyEvent,
            historyActor: state.historyActor,
          },
          read.signal,
        );
      }
      if (epoch !== this.epoch || read.signal.aborted) return;
      this.identity = identity;
      this.access = access;
      const projectChanged =
        project &&
        this.project &&
        (project.name !== this.project.name || project.previewSlug !== this.project.previewSlug);
      this.project = project;
      const navigation = this.allowedScreens();
      if (!navigation.includes(state.screen)) {
        this.navigate('Projects');
        return;
      }
      const oldId = this.visibleRows()[state.selected]?.id;
      const selected = page
        ? Math.max(
            0,
            this.filterRows(page.rows).findIndex((r) => r.id === oldId),
          )
        : state.selected;
      if (page?.cursor) this.cursors.set(state.page + 1, page.cursor);
      this.update({
        ...(page ? { rows: page.rows, hasNext: page.hasNext, selected } : {}),
        detail,
        navigation: destinations(navigation),
        screens: navigation,
        navIndex: Math.max(
          0,
          destinations(navigation).indexOf(
            state.navigation[state.navIndex] ?? destination(state.screen),
          ),
        ),
        project: project?.name ?? 'select a project',
        loading: false,
        error: undefined,
        lastRefresh: new Date().toISOString(),
        status: ['Connecting...', 'Loading...'].includes(this.state.status)
          ? 'Connected'
          : this.state.status,
        ...(projectChanged && this.state.modal?.kind === 'form'
          ? { modal: { ...this.state.modal, changed: true } }
          : {}),
      });
      this.schedule();
    } catch (error) {
      if (epoch !== this.epoch || read.signal.aborted) return;
      this.identityValidatedAt = 0;
      const code = errorCode(error);
      if (code === 3) {
        this.clearAccount('Session expired or revoked. Log in again.');
        return;
      }
      if (code === 4) {
        this.stopReads();
        this.project = undefined;
        this.selectedDeployment = undefined;
        this.update({
          rows: [],
          detail: undefined,
          modal:
            this.state.modal?.kind === 'form'
              ? {
                  ...this.state.modal,
                  changed: true,
                  error:
                    'Permission changed. This draft is preserved; select an accessible project and review again.',
                }
              : undefined,
          loading: false,
          error: this.text(error instanceof Error ? error.message : 'Permission denied.'),
          follow: false,
          watch: false,
          projectId: undefined,
          project: 'select a project',
          status: 'Permission denied. Choose another view or project.',
        });
        return;
      }
      this.update({
        loading: false,
        error: this.text(error instanceof Error ? error.message : 'Request failed.'),
        status:
          code === 5
            ? 'Not found. Refresh or return to the list.'
            : 'Data may be stale. Press r to retry.',
      });
      this.schedule(true);
    }
  }
  private resetLogs() {
    this.logs = [];
    this.gapSequences.clear();
    this.logBacklog = false;
  }
  private async loadLogs(value: ClientContext, signal: AbortSignal) {
    if (this.logs.length && !this.state.follow && this.state.detail) return this.state.detail;
    const input = {
      projectId: this.project!.id,
      deploymentId: this.selectedDeployment!.id,
      source: this.state.source,
    };
    let hasMore = true;
    let pages = 0;
    let gap = false;
    let after = this.afterSequence;
    let entries = [...this.logs];
    while (hasMore && pages++ < 20) {
      const result = await value.client.deployments.logsForward.query({
        ...input,
        limit: 100,
        afterSequence: after,
      });
      signal.throwIfAborted();
      gap ||= result.retentionGap;
      const known = new Set(entries.map((e) => e.sequence));
      entries.push(
        ...result.logs
          .filter((e) => !known.has(e.sequence))
          .map((e) => ({ ...e, content: this.text(e.content).slice(0, 16_384) })),
      );
      entries = entries.sort((a, b) => a.sequence - b.sequence).slice(-1000);
      after = result.afterSequence;
      hasMore = result.hasMore;
    }
    signal.throwIfAborted();
    this.logBacklog = hasMore;
    this.logs = entries;
    this.afterSequence = after;
    this.olderCursor = entries.length ? { sequence: entries[0]!.sequence } : null;
    if (gap && after !== undefined) this.gapSequences.add(after);
    const detail = detailDocument(
      row(
        input.deploymentId,
        `Logs for ${input.deploymentId}`,
        `${input.source} | ${this.state.follow ? 'following' : 'paused'} | ${this.state.autoScroll ? 'latest' : 'scroll paused'}`,
        {},
        [],
      ),
      [
        ...(this.gapSequences.size
          ? [
              {
                kind: 'text' as const,
                text: 'Retention gap: some unread log entries expired.',
                tone: 'warning' as const,
              },
            ]
          : []),
        ...logsDocument(entries),
      ],
    );
    return detail;
  }
  private async olderLogs() {
    if (!this.context || !this.project || !this.selectedDeployment || !this.olderCursor) return;
    await this.perform(
      'Loading older logs',
      async (signal) => {
        const value = this.requestContext(signal);
        const result = await value.client.deployments.logs.query({
          projectId: this.project!.id,
          deploymentId: this.selectedDeployment!.id,
          source: this.state.source,
          limit: 100,
          cursor: this.olderCursor!,
        });
        signal.throwIfAborted();
        const older = result.logs.map((e) => ({
          ...e,
          sequence: Number((e as { sequence?: number }).sequence ?? 0),
          content: this.text(e.content).slice(0, 16_384),
        }));
        const known = new Set(this.logs.map((e) => e.id));
        this.logs = [...older.filter((e) => !known.has(e.id)), ...this.logs].slice(0, 1000);
        this.olderCursor = result.nextCursor;
        const lines = this.logs
          .flatMap((e) => [e.createdAt.toISOString(), ...e.content.split('\n')])
          .slice(0, 5000);
        this.update({
          detail: detailDocument(
            row(
              this.selectedDeployment!.id,
              'Older logs',
              `${this.state.source} | paused | older entries`,
              {},
              lines,
            ),
            logsDocument(this.logs, true),
          ),
          follow: false,
          autoScroll: false,
          scroll: 0,
        });
      },
      false,
    );
  }
  private async showInstances() {
    try {
      const config = await this.deps.readConfiguration();
      this.update({
        rows: instanceRows(config.profiles, this.context?.name),
        loading: false,
      });
    } catch (error) {
      this.update({
        error: this.text(error instanceof Error ? error.message : 'Could not read profiles.'),
      });
    }
  }
  navigate(screen: Screen) {
    if (this.state.busy || !this.state.screens.includes(screen)) return;
    if (screen === 'Instances' && process.env['SENV_TOKEN']) {
      this.message('Instance is fixed', ['Unset SENV_TOKEN before switching or adding instances.']);
      return;
    }
    if (projectScreens.includes(screen) && screen !== 'Invitations' && !this.project) {
      this.navigate('Projects');
      return;
    }
    if (this.dirty()) {
      this.discard(() => this.navigate(screen));
      return;
    }
    this.stopReads();
    this.cursors.clear();
    this.logs = [];
    this.gapSequences.clear();
    this.afterSequence = undefined;
    this.olderCursor = undefined;
    this.selectedDeployment = undefined;
    this.update({
      screen,
      rows: [],
      selected: 0,
      detail: undefined,
      modal: undefined,
      page: 0,
      query: '',
      searching: false,
      scroll: 0,
      focus:
        this.state.focus === 'tabs' && (screen === 'Projects' || screen === 'Instances')
          ? 'content'
          : this.state.focus,
      navIndex: Math.max(0, this.state.navigation.indexOf(destination(screen))),
      error: undefined,
      follow: false,
      watch: false,
      status:
        screen === 'Invitations'
          ? 'Pending invitations. Use a to look up an invitation ID.'
          : 'Loading...',
    });
    void this.refresh();
  }
  private filterRows(rows: Row[]) {
    const query = this.state.query.toLowerCase();
    if (!query || ['Deployments', 'History', 'Invitations'].includes(this.state.screen))
      return rows;
    return rows.filter((r) => `${r.title} ${r.subtitle} ${r.id}`.toLowerCase().includes(query));
  }
  visibleRows() {
    return this.filterRows(this.state.rows);
  }
  selectedRow() {
    return this.visibleRows()[this.state.selected];
  }
  move(amount: number) {
    if (this.state.focus === 'navigation')
      this.update({
        navIndex: Math.max(
          0,
          Math.min(this.state.navigation.length - 1, this.state.navIndex + amount),
        ),
      });
    else if (this.state.focus === 'tabs') return;
    else if (this.state.detail) {
      const view = detailViewport(this.state, this.viewport.columns, this.viewport.rows);
      const scroll = Math.max(0, Math.min(view.maximum, view.start + amount));
      this.update({
        scroll,
        autoScroll: scroll === view.maximum && (amount > 0 || this.state.autoScroll),
      });
    } else
      this.update({
        selected: Math.max(
          0,
          Math.min(this.visibleRows().length - 1, this.state.selected + amount),
        ),
      });
  }
  setViewport(columns: number, rows: number) {
    if (columns < 40 || rows < 10) return;
    this.viewport = { columns, rows };
    if (this.state.detail && !this.state.modal) {
      const scroll = detailViewport(this.state, columns, rows).start;
      if (scroll !== this.state.scroll) this.update({ scroll });
    }
  }
  setScroll(scroll: number, latest = false) {
    this.update({ scroll: Math.max(0, scroll), autoScroll: latest });
  }
  jump(bottom: boolean) {
    if (this.state.focus === 'navigation')
      this.update({ navIndex: bottom ? this.state.navigation.length - 1 : 0 });
    else if (this.state.focus === 'tabs') return;
    else if (this.state.detail)
      this.setScroll(
        bottom ? detailViewport(this.state, this.viewport.columns, this.viewport.rows).maximum : 0,
        bottom,
      );
    else this.update({ selected: bottom ? Math.max(0, this.visibleRows().length - 1) : 0 });
  }
  toggleFocus(reverse = false) {
    const order: State['focus'][] = [
      'navigation',
      ...(this.tabs().length ? ['tabs' as const] : []),
      'content',
    ];
    this.update({
      focus:
        order[(order.indexOf(this.state.focus) + (reverse ? order.length - 1 : 1)) % order.length],
    });
  }
  beginSearch() {
    this.update({ searching: true, focus: 'content' });
  }
  search(query: string) {
    this.update({ query: terminalText(query).replaceAll('\n', '').slice(0, 254), selected: 0 });
  }
  finishSearch() {
    this.update({
      searching: false,
      page: 0,
      scroll: 0,
      ...(this.selectedDeployment && this.state.tab === 'History' && this.state.detail
        ? { detail: { ...this.state.detail, data: { ...this.state.detail.data, offset: 0 } } }
        : {}),
    });
    this.cursors.clear();
    if (
      ['Deployments', 'Invitations', 'History'].includes(this.state.screen) ||
      this.state.tab === 'History'
    )
      void this.refresh();
  }
  async page(direction: number) {
    if (this.state.busy || this.state.loading) return;
    if (this.state.detail && this.state.tab === 'History') {
      const offset = Number(this.state.detail.data.offset ?? 0);
      if (direction > 0 && !this.state.detail.data.hasNext) return;
      this.update({
        detail: {
          ...this.state.detail,
          data: { ...this.state.detail.data, offset: Math.max(0, offset + direction * 40) },
        },
        scroll: 0,
      });
    } else {
      if ((direction > 0 && !this.state.hasNext) || this.state.page + direction < 0) return;
      this.update({ page: this.state.page + direction, selected: 0, rows: [] });
    }
    await this.refresh();
  }
  async activate() {
    if (this.state.busy) return;
    if (this.state.focus === 'navigation') {
      const target = this.state.navigation[this.state.navIndex];
      if (target) {
        this.update({ focus: 'content' });
        this.navigate(target === 'Administration' ? 'Users' : target);
      }
      return;
    }
    if (this.state.focus === 'tabs') {
      this.update({ focus: 'content' });
      return;
    }
    const selected = this.selectedRow();
    if (!selected) {
      this.actions();
      return;
    }
    if (this.state.screen === 'Projects') {
      await this.perform(
        'Selecting project',
        async (signal) => {
          const project = await this.deps.selectProject(
            this.requestContext(signal),
            selected.id,
            this.identity!,
            this.access!,
          );
          signal.throwIfAborted();
          this.project = project;
          this.update({
            project: project.name,
            projectId: project.id,
            submittedDeploymentId: undefined,
          });
        },
        false,
      );
      if (this.project?.id === selected.id) this.navigate('Deployments');
    } else if (this.state.screen === 'Instances') {
      await this.switchInstance(selected.id);
    } else {
      this.update({ detail: selected, tab: 'Overview', scroll: 0, autoScroll: true });
      if (this.state.screen === 'Deployments') {
        this.selectedDeployment = selected;
        await this.refresh();
      } else if (this.state.screen === 'Users') {
        await this.perform(
          'Loading user',
          async (signal) => {
            const value = this.requireContext();
            const result = await authRequest<User | { user: User }>(
              value.profile.apiUrl,
              `admin/get-user?id=${encodeURIComponent(selected.id)}`,
              value.token,
              undefined,
              {},
              signal,
            );
            const user = 'user' in result ? result.user : result;
            this.update({ detail: row(user.id, user.email, user.name, user) });
          },
          false,
        );
      }
    }
  }
  tabs() {
    return this.selectedDeployment ? deploymentTabs : sectionTabs(this.state);
  }
  async tab(direction: number) {
    if (this.state.busy || this.state.focus === 'navigation') return;
    if (!this.selectedDeployment) {
      const tabs = sectionTabs(this.state);
      if (tabs.length < 2) return;
      const index = tabs.indexOf(this.state.screen);
      this.navigate(tabs[(index + direction + tabs.length) % tabs.length]!);
      return;
    }
    const index = deploymentTabs.indexOf(this.state.tab);
    this.stopReads();
    const tab =
      deploymentTabs[(index + direction + deploymentTabs.length) % deploymentTabs.length]!;
    this.logs = [];
    this.gapSequences.clear();
    this.afterSequence = undefined;
    this.olderCursor = undefined;
    this.update({
      tab,
      query: '',
      searching: false,
      scroll: 0,
      detail: row(this.selectedDeployment.id, tab, '', {}, []),
      follow: tab === 'Logs',
      autoScroll: true,
      watch: tab === 'Resources',
    });
    await this.refresh();
  }
  private dirty() {
    return (
      this.state.modal?.kind === 'form' &&
      this.state.modal.fields.some((f) => f.value !== (f.initialValue ?? ''))
    );
  }
  private discard(next: () => void) {
    this.restoreDraft = this.state.modal;
    this.afterDiscard = next;
    this.confirm('Discard this draft?', ['Your unsaved values will be lost.'], () => {
      this.formTask = undefined;
      this.restoreDraft = undefined;
      const callback = this.afterDiscard;
      this.afterDiscard = undefined;
      callback?.();
    });
  }
  back() {
    if (this.state.busy) {
      this.cancel();
      return;
    }
    if (this.state.modal) {
      if (this.state.modal.kind === 'form' && this.state.modal.review) {
        this.update({ modal: { ...this.state.modal, review: false } });
        return;
      }
      if (this.dirty()) {
        this.discard(() => this.closeModal());
        return;
      }
      this.closeModal();
    } else if (this.state.searching) {
      this.update({ searching: false });
    } else if (this.state.detail) {
      this.selectedDeployment = undefined;
      this.update({ detail: undefined, query: '', scroll: 0, follow: false, watch: false });
      void this.refresh();
    } else if (projectScreens.includes(this.state.screen)) {
      this.update({ focus: 'content' });
      this.navigate('Projects');
    } else this.update({ focus: 'navigation' });
  }
  requestQuit(code = 0) {
    if (this.state.suspended) return;
    if (this.state.busy) {
      this.cancel();
      return;
    }
    if (this.dirty()) {
      this.discard(() => this.onQuit(code));
      return;
    }
    this.onQuit(code);
  }
  cancel() {
    if (!this.operation) {
      this.requestQuit(130);
      return;
    }
    this.operation.abort();
    this.update({
      modal: undefined,
      status: this.mutationSent
        ? 'Request cancelled locally. Remote outcome is unknown; inspect before retrying.'
        : this.state.submittedDeploymentId
          ? `Observation cancelled. Deployment ${this.state.submittedDeploymentId} continues on the server.`
          : this.state.modal?.kind === 'login'
            ? 'Cancelling login. No credential will be saved.'
            : 'Cancelling local work.',
    });
  }
  closeModal() {
    this.previewTarget = undefined;
    if (this.deferredAccountFailure) {
      const message = this.deferredAccountFailure;
      this.deferredAccountFailure = undefined;
      this.secretLines = [];
      this.update({ modal: undefined });
      this.clearAccount(message);
      return;
    }
    if (this.restoreDraft) {
      const modal = this.restoreDraft;
      this.restoreDraft = undefined;
      this.confirmation = undefined;
      this.update({ modal });
      return;
    }
    this.formTask = undefined;
    this.reviewNotice = undefined;
    this.confirmation = undefined;
    this.update({ modal: undefined });
    if (!this.state.busy) void this.refresh();
  }
  message(title: string, lines: string[], secret = false) {
    this.secretLines = secret ? lines.map(terminalText) : [];
    this.update({
      scroll: 0,
      modal: {
        kind: 'message',
        title,
        lines: secret ? [] : lines.map((line) => this.text(line)),
        secret,
      },
    });
  }
  private confirm(title: string, lines: string[], task: () => void) {
    this.confirmation = task;
    this.update({
      modal: { kind: 'confirm', title, lines: lines.map((line) => this.text(line)), index: 0 },
    });
  }
  modalMove(amount: number) {
    const modal = this.state.modal;
    if (!modal) return;
    if (modal.kind === 'menu')
      this.update({
        modal: {
          ...modal,
          index: Math.max(0, Math.min(modal.actions.length - 1, modal.index + amount)),
        },
      });
    if (modal.kind === 'confirm')
      this.update({ modal: { ...modal, index: (modal.index + 1) % 2 } });
    if (modal.kind === 'form')
      this.update({
        modal: {
          ...modal,
          index: (modal.index + amount + modal.fields.length) % modal.fields.length,
        },
      });
  }
  editField(input: string, backspace = false, choice = 0, clear = false) {
    const modal = this.state.modal;
    if (modal?.kind !== 'form' || modal.review) return;
    const fields = [...modal.fields];
    const field = fields[modal.index]!;
    const value = field.choices
      ? field.choices[
          (Math.max(0, field.choices.indexOf(field.value)) + choice + field.choices.length) %
            field.choices.length
        ]!
      : clear
        ? ''
        : backspace
          ? Array.from(field.value).slice(0, -1).join('')
          : (field.value + terminalText(input).replaceAll('\n', '')).slice(0, 1024);
    fields[modal.index] = { ...field, value };
    this.update({ modal: { ...modal, fields, error: undefined } });
  }
  modalActivate() {
    const modal = this.state.modal;
    if (!modal || this.state.busy) return;
    if (modal.kind === 'message') {
      this.closeModal();
      return;
    }
    if (modal.kind === 'login') return;
    if (modal.kind === 'menu') {
      const action = modal.actions[modal.index];
      if (!action || action.disabled) return;
      this.closeModal();
      action.run();
    } else if (modal.kind === 'confirm') {
      const task = this.confirmation;
      const yes = modal.index === 1;
      this.confirmation = undefined;
      this.update({ modal: undefined });
      if (yes) task?.();
      else if (this.restoreDraft) {
        const draft = this.restoreDraft;
        this.restoreDraft = undefined;
        this.update({ modal: draft });
      }
    } else {
      if (!modal.review) {
        const missing = modal.fields.find((f) => f.required && !f.value.trim());
        if (missing) {
          this.update({ modal: { ...modal, error: `${missing.label} is required.` } });
          return;
        }
        const values = Object.fromEntries(modal.fields.map((f) => [f.key, f.value.trim()]));
        this.update({
          modal: {
            ...modal,
            review: true,
            changed: false,
            notice: this.reviewNotice?.(values).map((line) => this.text(line)) ?? modal.notice,
          },
        });
      } else {
        if (modal.changed) {
          this.update({
            modal: {
              ...modal,
              review: false,
              error: 'The saved project identity changed. Review the target again.',
            },
          });
          return;
        }
        const task = this.formTask;
        const values = Object.fromEntries(modal.fields.map((f) => [f.key, f.value.trim()]));
        this.formTask = undefined;
        this.update({ modal: undefined });
        if (task)
          void this.perform(
            modal.title,
            async (signal) => {
              try {
                await task(values, signal);
              } catch (error) {
                if (errorCode(error) === 2) {
                  this.formTask = task;
                  this.update({
                    modal: {
                      ...modal,
                      review: false,
                      error: this.text(error instanceof Error ? error.message : 'Invalid input.'),
                    },
                  });
                }
                throw error;
              }
            },
            this.formMutation,
          );
      }
    }
  }
  private form(
    title: string,
    fields: Field[],
    task: (values: Record<string, string>, signal: AbortSignal) => Promise<void>,
    mutation = true,
    notice?: string[] | ((values: Record<string, string>) => string[]),
  ) {
    this.formTask = task;
    this.formMutation = mutation;
    this.reviewNotice = typeof notice === 'function' ? notice : undefined;
    this.update({
      modal: {
        kind: 'form',
        title,
        fields: fields.map((field) => ({ ...field, initialValue: field.value })),
        index: 0,
        review: false,
        notice: Array.isArray(notice) ? notice : undefined,
      },
    });
  }
  private async perform(label: string, task: Task, mutation = true) {
    if (this.state.busy || this.disposed) return;
    this.stopReads();
    const controller = new AbortController();
    this.operation = controller;
    this.mutationSent = mutation;
    this.update({ busy: true, loading: false, status: label, error: undefined });
    let ambiguous = false;
    try {
      await task(controller.signal);
      if (!controller.signal.aborted) this.update({ status: `${label} completed.` });
    } catch (error) {
      if (!controller.signal.aborted) {
        const code = errorCode(error);
        ambiguous = this.mutationSent && unknownOutcome(error);
        if (code === 3) this.clearAccount('Session expired or revoked. Log in again.');
        else
          this.update({
            ...(this.state.modal?.kind === 'login' ? { modal: undefined } : {}),
            error: this.text(error instanceof Error ? error.message : 'Operation failed.'),
            status:
              this.mutationSent && unknownOutcome(error)
                ? 'Remote outcome may be unknown. Inspect existing records before retrying.'
                : code === 4
                  ? 'Permission denied. Refresh access before trying another action.'
                  : 'Operation failed. Review inputs and server state.',
          });
      }
    } finally {
      const inspect = ambiguous && Boolean(this.state.error);
      const operationError = this.state.error;
      this.mutationSent = false;
      this.identityValidatedAt = 0;
      this.operation = undefined;
      this.update({ busy: false });
      if (this.context && !this.state.modal && !controller.signal.aborted && !this.state.error)
        await this.refresh();
      else if (inspect && this.context) {
        await this.refresh();
        this.update({
          error: operationError,
          status:
            'Remote outcome may be unknown. Server state refreshed. Inspect the selected record or use actions before retrying.',
        });
      } else this.schedule();
    }
  }
  private mutation(
    label: string,
    task: (value: ClientContext, signal: AbortSignal) => Promise<unknown>,
    confirmation?: string[],
  ) {
    const execute = () => {
      void this.perform(label, async (signal) => {
        const result = await task(this.requestContext(signal), signal);
        if (!signal.aborted && result !== undefined) this.message(label, detailLines(result));
      });
    };
    if (confirmation)
      this.confirm(
        label,
        [
          `Instance: ${this.state.instance}`,
          `Project: ${this.state.project} (${this.project?.id ?? '-'})`,
          ...confirmation,
        ],
        execute,
      );
    else execute();
  }
  loginForm() {
    if (process.env['SENV_TOKEN']) {
      this.message('Process credential', [
        'SENV_TOKEN overrides saved credentials. Unset it to log in with a personal session.',
      ]);
      return;
    }
    this.form(
      'Browser-approved login',
      [
        {
          key: 'instance',
          label: 'Instance profile',
          value:
            this.context?.name ??
            this.options.instance ??
            process.env['SENV_INSTANCE'] ??
            (this.state.instance || 'default'),
          required: true,
        },
        {
          key: 'apiUrl',
          label: 'API origin',
          value:
            this.context?.profile.apiUrl ?? this.profileHint?.apiUrl ?? 'http://localhost:3000',
          required: true,
        },
        { key: 'label', label: 'Device label', value: `${hostname()} TUI`, required: true },
        { key: 'browser', label: 'Open browser', value: 'yes', choices: ['yes', 'no'] },
      ],
      async (values, signal) => {
        await this.deps.login({
          ...values,
          browser: values.browser === 'yes',
          signal,
          onCode: ({ url, code, expiresAt, label }) =>
            this.update({
              modal: {
                kind: 'login',
                title: 'Approve login in your browser',
                url,
                code,
                expiresAt,
                label,
                state: 'pending',
              },
            }),
          onState: (state) => {
            if (this.state.modal?.kind === 'login')
              this.update({ modal: { ...this.state.modal, state } });
          },
          onWarning: (message) => this.update({ status: this.text(message) }),
        });
        if (signal.aborted) return;
        this.options = {
          instance: values.instance,
          project:
            this.context?.name === values.instance
              ? (this.project?.id ?? this.options.project)
              : this.options.instance === values.instance
                ? this.options.project
                : undefined,
        };
        this.update({ modal: undefined });
        // connect fetches a fresh context after storage, not the cancelled view's client.
        await this.connect();
      },
      false,
    );
  }
  private async switchInstance(name: string) {
    if (process.env['SENV_TOKEN']) {
      this.message('Instance is fixed', ['Unset SENV_TOKEN before switching instances.']);
      return;
    }
    await this.perform(
      'Switch instance',
      async () => {
        const config = await this.deps.readConfiguration();
        if (!config.profiles[name]) throw new CliError('Unknown instance.', 2);

        this.clearAccount('');
        this.options = { instance: name };
        this.update({ instance: name });
        await this.connect();
      },
      false,
    );
  }
  private actionHost() {
    // Getters keep action callbacks tied to current state after async refreshes.
    // eslint-disable-next-line typescript/no-this-alias
    const controller = this;
    return {
      get access() {
        return controller.access;
      },
      activate: controller.activate.bind(controller),
      admin: controller.admin.bind(controller),
      get afterSequence() {
        return controller.afterSequence;
      },
      set afterSequence(value: number | undefined) {
        controller.afterSequence = value;
      },
      clearAccount: controller.clearAccount.bind(controller),
      confirm: controller.confirm.bind(controller),
      connect: controller.connect.bind(controller),
      get context() {
        return controller.context;
      },
      get deps() {
        return controller.deps;
      },
      form: controller.form.bind(controller),
      get identity() {
        return controller.identity;
      },
      jump: controller.jump.bind(controller),
      loginForm: controller.loginForm.bind(controller),
      get logs() {
        return controller.logs;
      },
      set logs(value: LogEntry[]) {
        controller.logs = value;
      },
      manage: controller.manage.bind(controller),
      message: controller.message.bind(controller),
      mutation: controller.mutation.bind(controller),
      navigate: controller.navigate.bind(controller),
      get olderCursor() {
        return controller.olderCursor;
      },
      set olderCursor(value: { sequence: number } | null | undefined) {
        controller.olderCursor = value;
      },
      olderLogs: controller.olderLogs.bind(controller),
      openProfile: controller.openProfile.bind(controller),
      openUrl: controller.openUrl.bind(controller),
      page: controller.page.bind(controller),
      perform: controller.perform.bind(controller),
      personal: controller.personal.bind(controller),
      prepareLink: controller.prepareLink.bind(controller),
      preparePublication: controller.preparePublication.bind(controller),
      prepareTag: controller.prepareTag.bind(controller),
      get previewTarget() {
        return controller.previewTarget;
      },
      set previewTarget(value: { projectId: string; deploymentId: string } | undefined) {
        controller.previewTarget = value;
      },
      get project() {
        return controller.project;
      },
      set project(value: Project | undefined) {
        controller.project = value;
      },
      refresh: controller.refresh.bind(controller),
      requestContext: controller.requestContext.bind(controller),
      requireContext: controller.requireContext.bind(controller),
      get selectedDeployment() {
        return controller.selectedDeployment;
      },
      selectedRow: controller.selectedRow.bind(controller),
      shell: controller.shell.bind(controller),
      showInstances: controller.showInstances.bind(controller),
      resetLogs: controller.resetLogs.bind(controller),
      get state() {
        return controller.state;
      },
      switchInstance: controller.switchInstance.bind(controller),
      tab: controller.tab.bind(controller),
      text: controller.text.bind(controller),
      update: controller.update.bind(controller),
    };
  }
  actions() {
    buildActions.call(this.actionHost());
  }
  private async prepareLink() {
    await this.perform(
      'Inspect project link',
      async () => {
        const existing = await nearestLink();
        this.confirm(
          existing ? 'Replace existing project link?' : 'Write .senv.json?',
          [
            existing ? `Existing link: ${existing.path}` : `Directory: ${process.cwd()}`,
            existing
              ? `Currently selects: ${existing.instance}/${existing.projectId}`
              : 'No existing link.',
            `New selection: ${this.context!.name}/${this.project!.id}`,
            'Cancel keeps the existing link. Confirm replaces it at the displayed path.',
          ],
          () => {
            void this.perform(
              'Link project',
              async () => {
                await linkProject(this.context!.name, this.project!.id, Boolean(existing));
              },
              false,
            );
          },
        );
      },
      false,
    );
  }
  private async preparePublication(retained?: Row) {
    await this.perform(
      'Loading publication limits',
      async (signal) => {
        const limits = await this.requestContext(signal).client.deployments.uploadConstraints.query(
          { projectId: this.project!.id },
        );
        if (!signal.aborted) this.publishForm(limits, retained);
      },
      false,
    );
  }
  private async prepareTag(input: { projectId: string; deploymentId: string }) {
    await this.perform(
      'Loading current tag targets',
      async (signal) => {
        const list = await this.requestContext(signal).client.deployments.list.query({
          projectId: input.projectId,
        });
        if (signal.aborted) return;
        const targets = new Map(
          list.deployments.flatMap((d) => d.tags.map((tag) => [tag, d.id] as const)),
        );
        this.form(
          'Assign preview tag',
          [{ key: 'name', label: 'Tag name', value: '', required: true }],
          async (v, signal) => {
            await this.requestContext(signal).client.deployments.assignTag.mutate({
              ...input,
              name: v.name!,
            });
          },
          true,
          (values) => {
            const current = targets.get(values.name!);
            return [
              `Tag: ${values.name}`,
              `Current target: ${current ?? 'unassigned'}`,
              `New target: ${input.deploymentId}`,
              'Assigning this tag changes its preview address target.',
            ];
          },
        );
      },
      false,
    );
  }
  private publishForm(limits: { maxBytes: number; maxEntries: number }, retained?: Row) {
    this.form(
      'Publish deployment',
      [
        {
          key: 'source',
          label: 'Source',
          value: retained ? 'reuse' : 'directory',
          choices: ['directory', 'archive', 'image', 'reuse'],
        },
        {
          key: 'input',
          label: 'Path, image reference, or retained deployment ID',
          value: retained?.id ?? '',
          required: true,
        },
        {
          key: 'kind',
          label: 'Kind for retained deployment',
          value: retained?.data.kind === 'container' ? 'container' : 'static',
          choices: ['static', 'container'],
        },
        {
          key: 'port',
          label: 'Application port (empty preserves retained port)',
          value: retained ? '' : '80',
        },
        { key: 'credential', label: 'Existing registry credential ID (optional)', value: '' },
        { key: 'branch', label: 'Source branch (optional)', value: '' },
        { key: 'commit', label: 'Source commit (optional)', value: '' },
        { key: 'pin', label: 'Pin deployment', value: 'no', choices: ['no', 'yes'] },
        { key: 'wait', label: 'Wait for publication', value: 'yes', choices: ['yes', 'no'] },
        { key: 'timeout', label: 'Wait timeout in seconds', value: '300', required: true },
      ],
      async (v, signal) => {
        this.update({ submittedDeploymentId: undefined });
        const projectId = this.project!.id;
        const port = v.port ? Number(v.port) : undefined,
          timeout = Number(v.timeout);
        if (
          (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) ||
          !Number.isInteger(timeout) ||
          timeout < 1 ||
          timeout > 3600
        )
          throw new CliError('Choose a valid port and a wait timeout of 1 to 3600 seconds.', 2);
        const value = this.requestContext(signal);
        if (v.source === 'reuse') {
          const retained = await value.client.deployments.detail.query({
            projectId,
            deploymentId: v.input!,
          });
          if (
            retained.kind !== v.kind ||
            (retained.kind === 'static' ? !retained.artifactId : !retained.imageDigest)
          )
            throw new CliError('The selected deployment has no retained source of that kind.', 2);
        }
        this.mutationSent = false;
        const result = await this.deps.publish(
          value,
          projectId,
          ['directory', 'archive'].includes(v.source!) ? v.input : undefined,
          {
            image: v.source === 'image' ? v.input : undefined,
            reuse: v.source === 'reuse' ? v.input : undefined,
            kind:
              v.source === 'reuse' && !retained ? undefined : (v.kind as 'static' | 'container'),
            port,
            registryCredential: v.credential || undefined,
            branch: v.branch || undefined,
            commit: v.commit || undefined,
            pin: v.pin === 'yes',
            signal,
            onProgress: (sent, total) =>
              this.update({
                status: `Uploading ${sent}/${total} bytes. Server upload bounds apply.`,
              }),
            onSubmit: () => {
              this.mutationSent = true;
              this.update({ status: 'Submitting publication...' });
            },
          },
        );
        this.mutationSent = false;
        const id = result.id;
        this.update({ submittedDeploymentId: id });
        this.update({
          status: `Deployment ${id} submitted. Cancelling now only stops observation.`,
        });
        if (v.wait === 'yes') {
          const outcome = await waitForPublication(value, projectId, id, timeout, signal);
          this.message(
            outcome.status === 'timeout' ? 'Publication wait timed out' : 'Publication outcome',
            [
              `Deployment ID: ${id}`,
              `Status: ${outcome.status}`,
              outcome.failureReason ?? '',
              'Inspect this deployment before retrying publication.',
            ],
          );
        } else
          this.message('Deployment submitted', [
            `Deployment ID: ${id}`,
            'Publication continues on the server.',
          ]);
      },
      false,
      [
        `Upload limit: ${limits.maxBytes} bytes; ${limits.maxEntries} entries.`,
        'The server applies existing project configuration.',
      ],
    );
  }
  private async openProfile() {
    const context = this.requireContext();
    const appUrl =
      context.profile.appUrl ??
      (await this.deps.apiClient(context.profile.apiUrl).cli.instance.query()).appUrl;
    validateApiUrl(appUrl);
    await this.openUrl(new URL('/profile', appUrl).href);
  }
  private async openUrl(input: string) {
    try {
      const url = new URL(input);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new CliError(
          'Only HTTP(S) browser URLs without embedded credentials are supported.',
          2,
        );
      await this.deps.open(url.href);
      this.message('Opened in browser', [url.href]);
    } catch (error) {
      this.message('Open this URL manually', [
        input,
        this.text(error instanceof Error ? error.message : 'Browser could not open.'),
      ]);
    }
  }
  private async shell(deploymentId: string, executable: string | undefined, signal: AbortSignal) {
    this.stopReads();
    this.update({ suspended: true });
    try {
      await this.suspendTerminal(async () => {
        const result = await this.deps.runShell(
          this.requireContext(),
          this.project!.id,
          deploymentId,
          executable,
          { signal, onMessage: (message) => process.stderr.write(`${terminalText(message)}\n`) },
        );
        this.message('Origin shell closed', [
          result.detached ? 'Detached locally.' : `Remote exit code: ${result.exitCode}`,
        ]);
      });
    } finally {
      this.update({ suspended: false });
    }
  }
  help() {
    this.message('Keyboard help', [
      'Tab / Shift-Tab: move between sidebar, tabs, and content',
      'Sidebar: Projects, Account, Administration, Instances. Arrows select, Enter opens.',
      'Project views are tabs. Account has Profile, Sessions, and Automation tokens tabs.',
      'Arrows or h/j/k/l: move selection, scroll details, and switch tabs',
      'gg / Home: top; G / End: bottom. G resumes following the latest log output.',
      'Enter: details / activate',
      'a: actions, including all mutations',
      '/: search loaded rows; deployment/history/invitation search applies on Enter',
      '[ / ]: previous / next page',
      'Left / Right: switch the visible project, account, administration, or deployment tabs',
      'Resources shows current CPU and memory alongside historical trends and samples.',
      'History includes all events, search, actor/event filters, and pagination.',
      'r: refresh, i: instance picker, p: project picker',
      'Esc: close details, then return from a project to Projects; q: quit',
      'Ctrl-C: cancel local work or quit',
      'Forms: Tab changes field; Left / Right changes choices; Ctrl-U clears text; Enter reviews, Enter submits; Esc edits or discards',
      'Confirmations default to Cancel. Select Confirm explicitly.',
      'Shell: Ctrl-C goes to the remote process; Ctrl-] detaches.',
      'Runtime/project settings and instance defaults are excluded.',
    ]);
  }
}

export type ActionHost = ReturnType<TuiController['actionHost']>;
