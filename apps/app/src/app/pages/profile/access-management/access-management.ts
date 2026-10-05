import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  linkedSignal,
  signal,
} from '@angular/core';
import { form, FormField, required, validate } from '@angular/forms/signals';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query';
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  injectTable,
  isFunction,
  type PaginationState,
  rowPaginationFeature,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  TanStackTable,
} from '@tanstack/angular-table';
import { ProjectsData } from '../../../queries/projects';
import { inject } from '@angular/core';
import { DurationInput } from '../../../ui/duration-input/duration-input';
import { TablePaginaton } from '../../../ui/table/pagination';
import { TableHeadSortButton } from '../../../ui/table/sort-header-button';
import type { TrpcService } from '../../../trpc/trpc.service';
import {
  injectAuthSessionId,
  injectIsImpersonating,
  injectLogout,
} from '../../../auth/auth-client';
import { injectTrpc } from '../../../trpc/trpc.service';
import { environment } from '../../../../environments/environment';

@Component({
  imports: [
    DatePipe,
    FormField,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmComboboxImports,
    HlmTableImports,
    FlexRender,
    TanStackTable,
    TablePaginaton,
    DurationInput,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    HlmToggleGroupImports,
  ],
  selector: 'app-access-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access-management.html',
})
export class AccessManagement {
  readonly apiUrl = environment.apiUrl;
  private readonly trpc = injectTrpc();
  private readonly projectsData = inject(ProjectsData);
  private readonly sessionId = injectAuthSessionId();
  private readonly logout = injectLogout();
  readonly impersonating = injectIsImpersonating();
  readonly busy = signal(false);
  readonly error = linkedSignal(() => {
    this.sessionId();
    return '';
  });
  readonly secret = linkedSignal(() => {
    this.sessionId();
    return '';
  });
  readonly tokenModel = signal({
    name: '',
    project: '',
    expiresInSeconds: 30 * 86400,
    permission: 'read',
  });
  readonly tokenForm = form(this.tokenModel, (path) => {
    required(path.name);
    required(path.project);
    validate(path.expiresInSeconds, ({ value }) => {
      const seconds = value();
      return Number.isNaN(seconds) ||
        (Number.isSafeInteger(seconds) &&
          seconds > 0 &&
          Number.isFinite(new Date(Date.now() + seconds * 1000).getTime()))
        ? undefined
        : {
            kind: 'duration',
            message:
              'Enter a positive duration in whole seconds, or leave it empty.',
          };
    });
  });
  readonly projects = injectInfiniteQuery(() => ({
    ...this.projectsData.list(this.sessionId()),
    enabled: !!this.sessionId() && !this.impersonating(),
  }));
  readonly projectOptions = computed(
    () =>
      this.projects.data()?.pages.flatMap((page) =>
        page.projects.map((project) => ({
          label: `${project.name} (${project.previewSlug})`,
          value: project.id,
        })),
      ) ?? [],
  );
  readonly selectedProject = computed(() =>
    this.projectOptions().find(
      (project) => project.value === this.tokenModel().project,
    ),
  );
  selectProject(option: unknown) {
    this.tokenForm
      .project()
      .value.set(
        option &&
          typeof option === 'object' &&
          'value' in option &&
          typeof option.value === 'string'
          ? option.value
          : '',
      );
    this.tokenForm.project().markAsTouched();
  }
  readonly sessions = injectQuery(() => ({
    queryKey: ['access-sessions', this.sessionId()],
    enabled: !!this.sessionId() && !this.impersonating(),
    queryFn: ({ signal }) =>
      this.trpc.client.cli.sessions.query(undefined, { signal }),
    refetchInterval: 30_000,
    retry: false,
  }));
  readonly tokens = injectQuery(() => ({
    queryKey: ['access-tokens', this.sessionId()],
    enabled: !!this.sessionId() && !this.impersonating(),
    queryFn: ({ signal }) =>
      this.trpc.client.cli.tokens.query(undefined, { signal }),
    retry: false,
  }));
  readonly sessionSearch = linkedSignal(() => {
    this.sessionId();
    return '';
  });
  readonly sessionColumns = sessionColumns;
  readonly sessionSorting = linkedSignal<SortingState>(() => {
    this.sessionId();
    return [{ id: 'lastActivityAt', desc: true }];
  });
  private readonly filteredSessions = computed(() => {
    const search = this.sessionSearch().trim().toLowerCase();
    return (this.sessions.data() ?? []).filter((session) =>
      `${session.label} ${session.kind} ${session.id} ${session.current ? 'current' : ''}`
        .toLowerCase()
        .includes(search),
    );
  });
  readonly sessionPagination = linkedSignal({
    source: () => ({
      identity: this.sessionId(),
      search: this.sessionSearch(),
      sorting: this.sessionSorting(),
      count: this.filteredSessions().length,
    }),
    computation: (source, previous): PaginationState => {
      const pageSize = previous?.value.pageSize ?? 10;
      const reset =
        !previous ||
        source.identity !== previous.source.identity ||
        source.search !== previous.source.search ||
        source.sorting !== previous.source.sorting;
      return {
        pageSize,
        pageIndex: reset
          ? 0
          : Math.min(
              previous.value.pageIndex,
              Math.max(0, Math.ceil(source.count / pageSize) - 1),
            ),
      };
    },
  });
  readonly sessionTable = injectTable(() => ({
    key: 'access-sessions',
    features: sessionFeatures,
    columns: sessionColumns,
    data: this.filteredSessions(),
    getRowId: (session) => session.id,
    state: {
      pagination: this.sessionPagination(),
      sorting: this.sessionSorting(),
    },
    onPaginationChange: (updater) =>
      this.sessionPagination.update((state) =>
        isFunction(updater) ? updater(state) : updater,
      ),
    onSortingChange: (updater) =>
      this.sessionSorting.update((state) =>
        isFunction(updater) ? updater(state) : updater,
      ),
  }));
  changePermission(value: string | string[] | null | undefined) {
    if (value === 'read' || value === 'manage')
      this.tokenForm.permission().value.set(value);
  }
  private async perform(action: () => Promise<unknown>) {
    if (this.busy() || this.impersonating()) return;
    const identity = this.sessionId();
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      if (identity === this.sessionId())
        await Promise.all([this.sessions.refetch(), this.tokens.refetch()]);
    } catch (error) {
      if (identity === this.sessionId())
        this.error.set(
          error instanceof Error ? error.message : 'Could not update access.',
        );
    } finally {
      this.busy.set(false);
    }
  }
  async revokeSession(id: string) {
    await this.perform(async () => {
      if (id === this.sessionId()) await this.logout();
      else await this.trpc.client.cli.revokeSession.mutate({ id });
    });
  }
  async revokeOthers() {
    await this.perform(() => this.trpc.client.cli.revokeOtherSessions.mutate());
  }
  async revokeToken(id: string) {
    await this.perform(() => this.trpc.client.cli.revokeToken.mutate({ id }));
  }
  async createToken() {
    if (this.tokenForm().invalid()) return;
    const identity = this.sessionId();
    this.secret.set('');
    await this.perform(async () => {
      const model = this.tokenModel();
      const project = await this.trpc.client.cli.project.query({
        project: model.project,
      });
      const created = await this.trpc.client.cli.createToken.mutate({
        name: model.name,
        projectId: project.id,
        permission: model.permission === 'manage' ? 'manage' : 'read',
        expiresInSeconds: Number.isNaN(model.expiresInSeconds)
          ? null
          : model.expiresInSeconds,
      });
      if (identity === this.sessionId()) this.secret.set(created.secret);
    });
  }
}

type AccessSession = Awaited<
  ReturnType<TrpcService['client']['cli']['sessions']['query']>
>[number];
const sessionFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  columnMeta: {} as { label: string },
});
const sessionColumn = createColumnHelper<
  typeof sessionFeatures,
  AccessSession
>();
const sessionDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const sessionColumns = sessionColumn.columns([
  sessionColumn.accessor('label', {
    header: () => TableHeadSortButton,
    meta: { label: 'Device' },
  }),
  sessionColumn.accessor('kind', { header: 'Type' }),
  ...(['createdAt', 'lastActivityAt', 'expiresAt'] as const).map((key) =>
    sessionColumn.accessor(key, {
      header: () => TableHeadSortButton,
      meta: {
        label:
          key === 'createdAt'
            ? 'Created'
            : key === 'lastActivityAt'
              ? 'Last active'
              : 'Expires',
      },
      cell: (info) => sessionDate.format(info.getValue()),
    }),
  ),
  sessionColumn.display({ id: 'actions', header: 'Actions' }),
]);
