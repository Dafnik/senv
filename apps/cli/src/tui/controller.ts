import { hostname } from 'node:os';
import { writeFile } from 'node:fs/promises';
import open from 'open';
import {
  apiClient,
  authRequest,
  resolveContext,
  type ClientContext,
  type ContextOptions,
} from '../api/client.ts';
import {
  readConfiguration,
  removeCredential,
  validateApiUrl,
  writeConfiguration,
} from '../profiles.ts';
import { CliError, errorCode } from '../errors.ts';
import { login, logout } from '../services/auth.ts';
import { publish } from '../services/publication.ts';
import { runShell } from '../services/shell.ts';
import { sleep } from '../services/timing.ts';
import { detailLines, safeText, terminalText } from './safety.ts';
import { detailViewport } from './viewport.ts';
import { dateLabel, detailDocument, logsDocument } from './deployment-detail.ts';
import { destination, destinations, projectScreens, sectionTabs } from './navigation.ts';
import {
  deploymentTabs,
  type Action,
  type Field,
  type Row,
  type Screen,
  type State,
} from './types.ts';
import {
  loadDeployment,
  loadScreen,
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
    return Boolean(
      this.project &&
      (this.access?.kind === 'automation'
        ? this.access.permission === 'manage'
        : ['developer', 'admin'].includes(this.project.role)),
    );
  }
  private admin() {
    return this.personal() && this.project?.role === 'admin';
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
      await this.refresh();
    } catch (error) {
      if (epoch !== this.epoch || read.signal.aborted) return;
      this.clearAccount(this.text(error instanceof Error ? error.message : 'Could not connect.'));
      await this.showInstances();
      this.navigate('Account');
      if (!process.env['SENV_TOKEN'] && [2, 3].includes(errorCode(error))) this.loginForm();
    }
  }
  private clearAccount(message: string) {
    this.stopReads();
    this.context = undefined;
    this.identity = undefined;
    this.access = undefined;
    this.project = undefined;
    this.selectedDeployment = undefined;
    this.logs = [];
    this.formTask = undefined;
    this.reviewNotice = undefined;
    this.restoreDraft = undefined;
    this.afterDiscard = undefined;
    this.confirmation = undefined;
    this.update({
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
    this.stopReads();
    this.operation?.abort();
    this.formTask = undefined;
    this.reviewNotice = undefined;
    this.restoreDraft = undefined;
    this.afterDiscard = undefined;
    this.confirmation = undefined;
    this.logs = [];
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
    const interval = failed
      ? 30_000
      : liveLogs
        ? this.logBacklog
          ? 0
          : 1000
        : resources
          ? 5000
          : 30_000;
    if (this.context)
      this.timer = setTimeout(() => {
        void this.refresh();
      }, interval);
  }
  async refresh() {
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
      const [identity, access] = await Promise.all([
        value.client.me.query(),
        value.client.cli.access.query(),
      ]);
      if (epoch !== this.epoch || read.signal.aborted) return;
      this.identity = identity;
      this.access = access;
      let project = this.project;
      if (project) project = await this.deps.selectProject(value, project.id, identity, access);
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
          modal: undefined,
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
    const lines = entries
      .flatMap((e) => [`${e.createdAt.toISOString()} #${e.sequence}`, ...e.content.split('\n')])
      .slice(-5000);
    if (gap) this.update({ status: 'Retention gap: some unread log entries expired.' });
    const detail = detailDocument(
      row(
        input.deploymentId,
        `Logs for ${input.deploymentId}`,
        `${input.source} | ${this.state.follow ? 'following' : 'paused'} | ${this.state.autoScroll ? 'latest' : 'scroll paused'}`,
        {},
        lines,
      ),
      logsDocument(entries),
    );
    return { ...detail, lines };
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
        rows: Object.entries(config.profiles).map(([name, p]) =>
          row(name, name, p.apiUrl, { name, apiUrl: p.apiUrl, appUrl: p.appUrl }),
        ),
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
    return this.state.modal?.kind === 'form' && this.state.modal.fields.some((f) => f.value !== '');
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
          : 'Cancelling local work. Submitted deployments continue on the server.',
    });
  }
  closeModal() {
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
    this.update({
      scroll: 0,
      modal: {
        kind: 'message',
        title,
        lines: lines.map((line) => (secret ? terminalText(line) : this.text(line))),
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
        fields,
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
    try {
      await task(controller.signal);
      if (!controller.signal.aborted) this.update({ status: `${label} completed.` });
    } catch (error) {
      if (!controller.signal.aborted) {
        const code = errorCode(error);
        if (code === 3) this.clearAccount('Session expired or revoked. Log in again.');
        else
          this.update({
            ...(this.state.modal?.kind === 'login' ? { modal: undefined } : {}),
            error: this.text(error instanceof Error ? error.message : 'Operation failed.'),
            status:
              this.mutationSent && code === 1
                ? 'Remote outcome may be unknown. Inspect existing records before retrying.'
                : code === 4
                  ? 'Permission denied. Refresh access before trying another action.'
                  : 'Operation failed. Review inputs and server state.',
          });
      }
    } finally {
      this.operation = undefined;
      this.update({ busy: false });
      if (this.context && !this.state.modal && !controller.signal.aborted && !this.state.error)
        await this.refresh();
      else this.schedule();
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
          onCode: ({ url, code, expiresAt }) =>
            this.update({
              modal: {
                kind: 'login',
                title: 'Approve login in your browser',
                url,
                code,
                expiresAt,
              },
            }),
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
    await this.perform(
      'Switch instance',
      async () => {
        const config = await this.deps.readConfiguration();
        if (!config.profiles[name]) throw new CliError('Unknown instance.', 2);
        config.active = name;
        await this.deps.writeConfiguration(config);
        this.clearAccount('');
        this.options = { instance: name };
        this.update({ instance: name });
        await this.connect();
      },
      false,
    );
  }
  actions() {
    if (this.state.busy) return;
    const selected = this.state.detail ?? this.selectedRow();
    const actions: Action[] = [];
    const add = (label: string, run: () => void, disabled?: string) =>
      actions.push({ label, run, disabled });
    const field = (
      key: string,
      label: string,
      value = '',
      choices?: string[],
      required = true,
    ): Field => ({ key, label, value, choices, required });
    const unavailable = this.manage() ? undefined : 'Deployment manage permission required';
    const adminOnly = this.admin() ? undefined : 'Project admin required';
    const personalOnly = this.personal() ? undefined : 'Personal non-impersonated session required';
    if (this.state.detail && this.selectedDeployment) {
      for (const tab of deploymentTabs)
        add(tab, () => {
          void this.tab(deploymentTabs.indexOf(tab) - deploymentTabs.indexOf(this.state.tab));
        });
      if (this.state.tab === 'Logs') {
        add(this.state.follow ? 'Pause follow' : 'Follow logs', () => {
          this.update({ follow: !this.state.follow });
          void this.refresh();
        });
        add(`Switch log source to ${this.state.source === 'origin' ? 'proxy' : 'origin'}`, () => {
          this.logs = [];
          this.afterSequence = undefined;
          this.olderCursor = undefined;
          this.update({
            source: this.state.source === 'origin' ? 'proxy' : 'origin',
            detail: row(this.selectedDeployment!.id, 'Logs', '', {}, []),
            scroll: 0,
          });
          void this.refresh();
        });
        add(
          'Load older logs',
          () => {
            void this.olderLogs();
          },
          this.olderCursor === null ? 'No older entries' : undefined,
        );
        add('Scroll to latest', () => this.jump(true));
      }
      if (this.state.tab === 'Resources') {
        add(this.state.watch ? 'Pause resource watch' : 'Watch resources', () => {
          this.update({ watch: !this.state.watch });
          void this.refresh();
        });
      }
    }
    if (
      this.state.screen === 'History' ||
      (this.selectedDeployment && this.state.tab === 'History')
    ) {
      add('Filter history events and actors', () =>
        this.form(
          'History filters',
          [
            field('event', 'Event (optional)', this.state.historyEvent, undefined, false),
            field(
              'actor',
              'Actor ID or system (optional)',
              this.state.historyActor,
              undefined,
              false,
            ),
          ],
          async (v) => {
            this.update({
              historyEvent: v.event!,
              historyActor: v.actor!,
              page: 0,
              rows: [],
              scroll: 0,
              ...(this.selectedDeployment && this.state.detail
                ? {
                    detail: {
                      ...this.state.detail,
                      data: { ...this.state.detail.data, offset: 0 },
                    },
                  }
                : {}),
            });
          },
          false,
        ),
      );
    }
    switch (this.state.screen) {
      case 'Account':
        if (!this.context)
          add('Retry connection', () => {
            void this.connect();
          });
        add(
          'Log in / switch account',
          () => this.loginForm(),
          process.env['SENV_TOKEN'] ? 'Unset SENV_TOKEN first' : undefined,
        );
        if (this.context) {
          for (const localOnly of [false, true])
            add(
              localOnly
                ? 'Local-only logout (server session stays active)'
                : 'Logout and revoke session',
              () => {
                this.confirm(
                  'Sign out?',
                  [
                    localOnly
                      ? 'Only the local credential will be removed. The server session remains active.'
                      : 'The current CLI session will be revoked on the server.',
                  ],
                  () => {
                    void this.perform('Logout', async () => {
                      await this.deps.logout(this.requireContext(), localOnly);
                      this.clearAccount('Signed out.');
                    });
                  },
                );
              },
              process.env['SENV_TOKEN'] ? 'Unset or revoke SENV_TOKEN instead' : personalOnly,
            );
          add('Open browser profile / password recovery', () => {
            void this.openProfile();
          });
        }
        break;
      case 'Instances':
        add('Add instance profile', () =>
          this.form(
            'Add instance profile',
            [field('name', 'Profile name'), field('apiUrl', 'API origin', 'http://localhost:3000')],
            async (v, signal) => {
              const config = await this.deps.readConfiguration();
              if (config.profiles[v.name!]) throw new CliError('Instance already exists.', 2);
              const apiUrl = validateApiUrl(v.apiUrl!);
              const instance = await apiClient(apiUrl, undefined, signal).cli.instance.query();
              config.profiles[v.name!] = { apiUrl, appUrl: validateApiUrl(instance.appUrl) };
              config.active ??= v.name;
              await this.deps.writeConfiguration(config);
              await this.showInstances();
            },
            false,
          ),
        );
        if (selected)
          add('Use this instance', () => {
            void this.switchInstance(selected.id);
          });
        add('Login to an instance', () => this.loginForm());
        break;
      case 'Projects':
        if (this.personal())
          add('Invitations / look up invitation ID', () => this.navigate('Invitations'));
        add(
          'Create project',
          () =>
            this.form(
              'Create project',
              [
                field('name', 'Project name'),
                field('slug', 'Preview slug (optional)', '', undefined, false),
              ],
              async (v, signal) => {
                const result = await this.requestContext(signal).client.projects.create.mutate({
                  name: v.name!,
                  previewSlug: v.slug || undefined,
                });
                this.message('Project created', detailLines(result));
              },
            ),
          personalOnly,
        );
        if (selected)
          add('Show project identity', () => this.update({ detail: selected, scroll: 0 }));
        break;
      case 'Deployments': {
        add(
          'Publish deployment',
          () => {
            void this.preparePublication();
          },
          unavailable,
        );
        add('Filter by lifecycle status', () =>
          this.form(
            'Filter deployments',
            [
              field('status', 'Status', this.state.deploymentFilter || 'all', [
                'all',
                'queued',
                'starting',
                'healthy',
                'unhealthy',
                'failed',
                'stopped',
                'deleted',
                'cleaned',
              ]),
            ],
            async (v) => {
              this.update({
                deploymentFilter: v.status === 'all' ? '' : v.status,
                page: 0,
                rows: [],
              });
            },
            false,
          ),
        );
        const deployment = this.selectedDeployment ?? selected;
        if (!deployment) break;
        const input = { projectId: this.project!.id, deploymentId: deployment.id };
        const removed =
          Boolean(deployment.data.removalPending) ||
          ['deleted', 'cleaned'].includes(String(deployment.data.status));
        for (const operation of ['stop', 'restart', 'delete'] as const)
          add(
            `${operation[0]!.toUpperCase()}${operation.slice(1)} deployment`,
            () =>
              this.mutation(
                `${operation} deployment`,
                (v) => v.client.deployments[operation].mutate(input),
                operation === 'delete'
                  ? [
                      `Deployment: ${deployment.id}`,
                      'The server will delete the deployment and its runtime. This cannot be undone.',
                    ]
                  : undefined,
              ),
            unavailable ?? (removed ? 'Deployment removed or removal pending' : undefined),
          );
        add(
          deployment.data.pinned ? 'Unpin deployment' : 'Pin deployment',
          () =>
            this.mutation('Change pinning', (v) =>
              v.client.deployments.setPinned.mutate({ ...input, pinned: !deployment.data.pinned }),
            ),
          unavailable ?? (removed ? 'Deployment removed or removal pending' : undefined),
        );
        add(
          'Assign / move preview tag',
          () => {
            void this.prepareTag(input);
          },
          unavailable ?? (removed ? 'Deployment removed' : undefined),
        );
        const tags = Array.isArray(deployment.data.tags) ? deployment.data.tags.map(String) : [];
        add(
          'Remove preview tag',
          () =>
            this.form(
              'Remove preview tag',
              [field('name', 'Tag', tags[0] ?? '', tags.length ? tags : undefined)],
              async (v, signal) => {
                await this.requestContext(signal).client.deployments.removeTag.mutate({
                  projectId: input.projectId,
                  name: v.name!,
                });
              },
            ),
          unavailable ?? (!tags.length ? 'No tags on this deployment' : undefined),
        );
        add('Check public preview status', () => {
          void this.perform(
            'Preview status',
            async (signal) => {
              const preview =
                await this.requestContext(signal).client.deployments.previewStatus.query(input);
              this.message('Public preview status', [
                preview.error ??
                  `HTTP ${preview.statusCode} response in ${preview.responseTimeMs} ms`,
                '',
                'Address',
                preview.url,
                '',
                `Checked ${dateLabel(preview.checkedAt)}`,
              ]);
            },
            false,
          );
        });
        add('Open fixed preview URL', () => {
          void this.openUrl(String(deployment.data.previewUrl));
        });
        const addresses = deployment.data.addresses as
          | { branch?: string; tags?: { name: string; url: string }[] }
          | undefined;
        if (addresses?.branch)
          add('Open branch preview URL', () => {
            void this.openUrl(addresses.branch!);
          });
        for (const tag of addresses?.tags ?? [])
          add(`Open tag ${this.text(tag.name)}`, () => {
            void this.openUrl(tag.url);
          });
        add(
          'Open origin shell',
          () =>
            this.form(
              'Open origin shell',
              [field('shell', 'Absolute shell path (optional)', '', undefined, false)],
              async (v, signal) => {
                if (v.shell && !v.shell.startsWith('/'))
                  throw new CliError('Shell path must be absolute.', 2);
                await this.shell(deployment.id, v.shell || undefined, signal);
              },
              false,
            ),
          personalOnly ??
            unavailable ??
            (!['healthy', 'unhealthy', 'starting'].includes(String(deployment.data.status))
              ? 'Origin must be running'
              : undefined),
        );
        add(
          'Publish using this retained source',
          () => {
            void this.preparePublication(deployment);
          },
          (unavailable ??
            (deployment.data.kind === 'static'
              ? !deployment.data.artifactId
              : !deployment.data.imageDigest))
            ? (unavailable ?? 'No retained source available')
            : undefined,
        );
        break;
      }
      case 'History':
        if (selected)
          add(
            'Remove deployment history permanently',
            () =>
              this.mutation(
                'Remove deployment history',
                (v) =>
                  v.client.deployments.removeHistory.mutate({
                    projectId: this.project!.id,
                    deploymentId: String(selected.data.deploymentId),
                  }),
                [
                  `Deployment: ${selected.data.deploymentId}`,
                  'Only deleted/cleaned deployments with no retained artifact can be removed. This deletes their history record permanently.',
                ],
              ),
            adminOnly,
          );
        break;
      case 'Members':
        if (selected) {
          add(
            'Change member role',
            () =>
              this.form(
                'Change project role',
                [
                  field('role', 'Project role', String(selected.data.role), [
                    'viewer',
                    'developer',
                    'admin',
                  ]),
                ],
                async (v, signal) => {
                  await this.requestContext(signal).client.projects.changeMemberRole.mutate({
                    projectId: this.project!.id,
                    memberId: selected.id,
                    role: v.role as 'viewer' | 'developer' | 'admin',
                  });
                },
              ),
            adminOnly,
          );
          add(
            'Remove member',
            () =>
              this.mutation(
                'Remove project member',
                (v) =>
                  v.client.projects.removeMember.mutate({
                    projectId: this.project!.id,
                    memberId: selected.id,
                  }),
                [
                  `Member: ${selected.title} (${selected.id})`,
                  'This account will lose project membership.',
                ],
              ),
            adminOnly,
          );
        }
        break;
      case 'Invitations':
        add('Look up invitation ID', () =>
          this.form(
            'Inspect invitation',
            [field('id', 'Invitation ID')],
            async (v, signal) => {
              const result = await this.requestContext(signal).client.projects.invitation.query({
                invitationId: v.id!,
              });
              const invitation = row(
                v.id!,
                result.organizationName,
                `Invited role: ${result.role}`,
                { ...result, recipient: true },
              );
              this.update({ detail: invitation, scroll: 0 });
            },
            false,
          ),
        );
        add(
          'Create project invitation',
          () =>
            this.form(
              'Create project invitation',
              [
                field('email', 'Email address'),
                field('role', 'Project role', 'viewer', ['viewer', 'developer', 'admin']),
              ],
              async (v, signal) => {
                const result = await this.requestContext(signal).client.projects.invite.mutate({
                  projectId: this.project!.id,
                  email: v.email!,
                  role: v.role as 'viewer' | 'developer' | 'admin',
                });
                this.message('Invitation result', detailLines(result));
              },
            ),
          adminOnly,
        );
        if (selected) {
          if (selected.data.recipient)
            for (const operation of ['accept', 'reject'] as const)
              add(`${operation} invitation`, () =>
                this.mutation(`${operation} invitation`, (v, signal) =>
                  authRequest(
                    v.profile.apiUrl,
                    `organization/${operation}-invitation`,
                    v.token,
                    { invitationId: selected.id },
                    {},
                    signal,
                  ),
                ),
              );
          else
            add(
              'Cancel invitation',
              () =>
                this.mutation(
                  'Cancel invitation',
                  (v) =>
                    v.client.projects.cancelInvitation.mutate({
                      projectId: this.project!.id,
                      invitationId: selected.id,
                    }),
                  [`Invitation: ${selected.title} (${selected.id})`],
                ),
              adminOnly,
            );
        }
        if (!this.identity?.emailVerified)
          add('Open browser for email verification', () => {
            void this.openProfile();
          });
        break;
      case 'Sessions':
        if (selected)
          add(
            'Revoke this session',
            () =>
              this.confirm(
                'Revoke session?',
                [
                  `${selected.title} (${selected.id})`,
                  selected.data.current
                    ? 'This is the current session. You will be signed out.'
                    : 'That browser or terminal will lose access.',
                ],
                () => {
                  void this.perform('Revoke session', async (signal) => {
                    await this.requestContext(signal).client.cli.revokeSession.mutate({
                      id: selected.id,
                    });
                    if (selected.data.current) {
                      const ctx = this.requireContext();
                      if (!process.env['SENV_TOKEN'])
                        await removeCredential(ctx.configuration, ctx.name, ctx.profile);
                      this.clearAccount('Current session revoked.');
                    }
                  });
                },
              ),
            personalOnly,
          );
        add(
          'Revoke all other sessions',
          () =>
            this.mutation(
              'Revoke other sessions',
              (v) => v.client.cli.revokeOtherSessions.mutate(),
              ['All other browser and CLI sessions for this account will be signed out.'],
            ),
          personalOnly,
        );
        break;
      case 'Automation tokens':
        add(
          'Create project token',
          () =>
            this.form(
              'Create project token',
              [
                field('name', 'Token name'),
                field('project', 'Project slug or ID', this.project?.id ?? ''),
                field('permission', 'Deployment permission', 'read', ['read', 'manage']),
                field('duration', 'Lifetime (empty means never expires)', '30', undefined, false),
                field('unit', 'Lifetime unit', 'days', ['seconds', 'days', 'months', 'years']),
              ],
              async (v, signal) => {
                const multiplier = { seconds: 1, days: 86400, months: 2592000, years: 31536000 }[
                  v.unit as 'seconds' | 'days' | 'months' | 'years'
                ]!;
                const seconds = v.duration ? Number(v.duration) * multiplier : null;
                if (
                  seconds !== null &&
                  (!Number.isSafeInteger(seconds) ||
                    seconds <= 0 ||
                    !Number.isFinite(new Date(Date.now() + seconds * 1000).getTime()))
                )
                  throw new CliError(
                    'Choose a positive duration in whole seconds, or leave it empty.',
                    2,
                  );
                const ctx = this.requestContext(signal);
                const project = await ctx.client.cli.project.query({ project: v.project! });
                const result = await ctx.client.cli.createToken.mutate({
                  projectId: project.id,
                  name: v.name!,
                  permission: v.permission as 'read' | 'manage',
                  expiresInSeconds: seconds,
                });
                this.message(
                  'Save this token now. It will not be shown again.',
                  [
                    result.secret,
                    `ID: ${result.id}`,
                    `Expires: ${result.expiresAt?.toISOString() ?? 'Never'}`,
                    'Leaving this view clears the secret.',
                  ],
                  true,
                );
              },
            ),
          personalOnly,
        );
        if (selected)
          add(
            'Revoke token',
            () =>
              this.mutation(
                'Revoke automation token',
                (v) => v.client.cli.revokeToken.mutate({ id: selected.id }),
                [
                  `Token: ${selected.title} (${selected.id})`,
                  'New requests using this token will fail immediately.',
                ],
              ),
            selected.data.revokedAt ? 'Already revoked' : personalOnly,
          );
        break;
      case 'Users':
        add('Create user and send signup email', () =>
          this.form(
            'Create user',
            [field('name', 'Name'), field('email', 'Email address')],
            async (v, signal) => {
              const ctx = this.requireContext();
              const result = await authRequest(
                ctx.profile.apiUrl,
                'admin/create-user',
                ctx.token,
                { name: v.name, email: v.email, role: 'user' },
                {},
                signal,
              );
              this.message('Account creation / email result', detailLines(result));
            },
          ),
        );
        if (selected) {
          add('Change instance role', () =>
            this.form(
              'Change instance role',
              [
                field('role', 'Instance role', String(selected.data.role ?? 'user'), [
                  'user',
                  'admin',
                ]),
              ],
              async (v, signal) => {
                const ctx = this.requireContext();
                await authRequest(
                  ctx.profile.apiUrl,
                  'admin/set-role',
                  ctx.token,
                  { userId: selected.id, role: v.role },
                  {},
                  signal,
                );
              },
            ),
          );
          add('Delete user', () =>
            this.mutation(
              'Delete user',
              (v, signal) =>
                authRequest(
                  v.profile.apiUrl,
                  'admin/remove-user',
                  v.token,
                  { userId: selected.id },
                  {},
                  signal,
                ),
              [
                `User: ${selected.title} (${selected.id})`,
                'This permanently removes the account. Server admin safeguards still apply.',
              ],
            ),
          );
          for (const [label, endpoint] of [
            ['Resend signup email', 'account-signup/resend'],
            ['Send password reset email', 'account-password/admin-reset'],
          ] as const)
            add(label, () =>
              this.mutation(label, (v, signal) =>
                authRequest(
                  v.profile.apiUrl,
                  endpoint,
                  v.token,
                  { userId: selected.id },
                  {},
                  signal,
                ),
              ),
            );
        }
        break;
      case 'Instance statistics':
        break;
    }
    if (
      this.project &&
      (this.state.screen === 'Projects' || projectScreens.includes(this.state.screen))
    ) {
      add(
        'Rename current project',
        () =>
          this.form(
            'Rename project',
            [field('name', 'Project name', this.project!.name)],
            async (v, signal) => {
              await this.requestContext(signal).client.projects.rename.mutate({
                projectId: this.project!.id,
                name: v.name!,
              });
              this.project = { ...this.project!, name: v.name! };
              this.update({ project: v.name });
            },
          ),
        adminOnly,
      );
      add(
        'Change current project preview slug',
        () =>
          this.form(
            'Change preview slug (preview URLs will change)',
            [field('slug', 'Preview slug', this.project!.previewSlug)],
            async (v, signal) => {
              await this.requestContext(signal).client.projects.updatePreviewSlug.mutate({
                projectId: this.project!.id,
                previewSlug: v.slug!,
              });
              this.project = { ...this.project!, previewSlug: v.slug! };
            },
          ),
        adminOnly,
      );
      add('Link working directory to current project', () =>
        this.confirm(
          'Write .senv.json?',
          [
            `Directory: ${process.cwd()}`,
            `Instance: ${this.state.instance}`,
            `Project ID: ${this.project!.id}`,
            'An existing link will not be overwritten. No credentials or remote settings are saved.',
          ],
          () => {
            void this.perform(
              'Link project',
              async () => {
                await writeFile(
                  '.senv.json',
                  `${JSON.stringify({ instance: this.context!.name, projectId: this.project!.id }, null, 2)}\n`,
                  { flag: 'wx' },
                );
              },
              false,
            );
          },
        ),
      );
    }
    if (this.state.hasNext || this.state.detail?.data.hasNext)
      add('Next page', () => {
        void this.page(1);
      });
    if (this.state.page > 0 || Number(this.state.detail?.data.offset ?? 0) > 0)
      add('Previous page', () => {
        void this.page(-1);
      });
    add('Refresh', () => {
      void this.refresh();
    });
    add('Switch instance', () => this.navigate('Instances'));
    if (this.access) add('Select project', () => this.navigate('Projects'));
    this.update({
      modal: { kind: 'menu', title: `${this.state.screen} actions`, actions, index: 0 },
    });
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
        { key: 'port', label: 'Application port', value: '80', required: true },
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
        const port = Number(v.port),
          timeout = Number(v.timeout);
        if (
          !Number.isInteger(port) ||
          port < 1 ||
          port > 65535 ||
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
            kind: v.kind as 'static' | 'container',
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
          const until = Date.now() + timeout * 1000;
          while (Date.now() < until) {
            const detail = await value.client.deployments.detail.query({
              projectId,
              deploymentId: id,
            });
            if (['healthy', 'failed', 'stopped', 'deleted', 'cleaned'].includes(detail.status)) {
              this.message('Publication outcome', [
                `Deployment ID: ${id}`,
                `Status: ${detail.status}`,
                detail.failureReason ?? '',
              ]);
              return;
            }
            await sleep(1000, signal);
          }
          this.message('Publication wait timed out', [
            `Deployment ID: ${id}`,
            'Inspect this deployment. Do not republish automatically.',
          ]);
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
