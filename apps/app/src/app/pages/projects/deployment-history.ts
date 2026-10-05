import {
  ChangeDetectionStrategy,
  Component,
  computed,
  debounced,
  effect,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { injectQuery } from '@tanstack/angular-query';
import {
  FlexRender,
  injectTable,
  isFunction,
  type PaginationState,
  type SortingState,
  TanStackTable,
} from '@tanstack/angular-table';
import {
  deploymentAuditSortFields,
  type DeploymentAuditQuery,
} from '@senv/api/shared/deployment-audit';
import { injectAuthSessionId } from '../../auth/auth-client';
import { DeploymentsData } from '../../queries/deployments';
import { lastPageIndex } from '../../tools/table/pagination';
import { TablePaginaton } from '../../ui/table/pagination';
import { DeploymentHistoryEmptyState } from './deployment-history-empty-state';
import {
  deploymentAuditColumns,
  deploymentAuditTableFeatures,
} from './deployment-audit-columns';

@Component({
  selector: 'app-deployment-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FlexRender,
    TanStackTable,
    TablePaginaton,
    HlmButtonImports,
    HlmCardImports,
    DeploymentHistoryEmptyState,
    HlmInputImports,
    HlmSelectImports,
    HlmSpinnerImports,
    HlmTableImports,
  ],
  host: { class: 'grid gap-4 min-w-0' },
  templateUrl: './deployment-history.html',
})
export class DeploymentHistory {
  readonly projectId = input.required<string>();
  readonly deploymentId = input<string>();
  readonly title = input('Deployment history');
  private readonly data = inject(DeploymentsData);
  private readonly sessionId = injectAuthSessionId();
  readonly columns = computed(() =>
    deploymentAuditColumns(!this.deploymentId()),
  );
  readonly eventSelectId = computed(() => this.selectId('event'));
  readonly actorSelectId = computed(() => this.selectId('actor'));
  readonly search = linkedSignal(() => {
    this.projectId();
    this.deploymentId();
    this.sessionId();
    return '';
  });
  private readonly debouncedSearch = debounced(this.search, 300);
  readonly eventFilter = linkedSignal(() => {
    this.projectId();
    this.deploymentId();
    this.sessionId();
    return '';
  });
  readonly actorFilter = linkedSignal(() => {
    this.projectId();
    this.deploymentId();
    this.sessionId();
    return '';
  });
  readonly sorting = linkedSignal<SortingState>(() => {
    this.projectId();
    this.deploymentId();
    this.sessionId();
    return [{ id: 'createdAt', desc: true }];
  });
  readonly pagination = linkedSignal({
    source: () => [
      this.projectId(),
      this.deploymentId(),
      this.sessionId(),
      this.debouncedSearch.value(),
      this.eventFilter(),
      this.actorFilter(),
      this.sorting(),
    ],
    computation: (_, previous): PaginationState => ({
      pageIndex: 0,
      pageSize: previous?.value.pageSize ?? 20,
    }),
  });
  readonly audit = injectQuery(() => {
    const { pageIndex, pageSize } = this.pagination();
    const sort = this.sorting()[0];
    const sortBy: DeploymentAuditQuery['sortBy'] =
      sort &&
      deploymentAuditSortFields.includes(
        sort.id as (typeof deploymentAuditSortFields)[number],
      )
        ? (sort.id as DeploymentAuditQuery['sortBy'])
        : 'createdAt';
    return this.data.audit(this.sessionId(), {
      projectId: this.projectId(),
      ...(this.deploymentId() ? { deploymentId: this.deploymentId() } : {}),
      offset: pageIndex * pageSize,
      limit: pageSize,
      search: this.debouncedSearch.value() ?? '',
      event: this.eventFilter() || undefined,
      actor: this.actorFilter() || undefined,
      sortBy,
      sortDirection: sort?.desc ? 'desc' : 'asc',
    });
  });
  readonly eventItemToString = (value: string) =>
    value === 'all' ? 'All events' : value.split('_').join(' ');
  readonly actorItemToString = (value: string) =>
    value === 'all'
      ? 'All actors'
      : (this.audit.data()?.actors.find((actor) => actor.id === value)?.name ??
        value);
  readonly table = injectTable(() => ({
    key: 'deployment-audit',
    features: deploymentAuditTableFeatures,
    columns: this.columns(),
    data: this.audit.isError() ? [] : (this.audit.data()?.entries ?? []),
    rowCount: this.audit.data()?.total ?? 0,
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { pagination: this.pagination(), sorting: this.sorting() },
    onPaginationChange: (updater) =>
      this.pagination.set(
        isFunction(updater) ? updater(this.pagination()) : updater,
      ),
    onSortingChange: (updater) =>
      this.sorting.set(isFunction(updater) ? updater(this.sorting()) : updater),
  }));
  readonly hasFilters = computed(
    () =>
      !!this.search().trim() || !!this.eventFilter() || !!this.actorFilter(),
  );

  constructor() {
    effect(() => {
      const total = this.audit.data()?.total;
      if (total === undefined) return;
      const page = this.pagination();
      const lastPage = lastPageIndex(total, page.pageSize);
      if (page.pageIndex > lastPage)
        this.pagination.set({ ...page, pageIndex: lastPage });
    });
  }

  detailsLabel(entry: { details: Record<string, unknown> }) {
    return JSON.stringify(entry.details);
  }

  private selectId(kind: 'event' | 'actor') {
    const scope = `${this.projectId()}-${this.deploymentId() ?? 'project'}`;
    return `deployment-audit-${kind}-${scope.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  updateSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  setEventFilter(value: string | null | undefined) {
    this.eventFilter.set(value && value !== 'all' ? value : '');
  }

  setActorFilter(value: string | null | undefined) {
    this.actorFilter.set(value && value !== 'all' ? value : '');
  }

  clearFilters() {
    this.search.set('');
    this.eventFilter.set('');
    this.actorFilter.set('');
  }
}
