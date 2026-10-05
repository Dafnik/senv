import { TitleCasePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  debounced,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { isInvitationSortField } from '@senv/api/shared/project-invitations';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
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
import { injectAuthSessionId } from '../../../auth/auth-client';
import { ProjectsData } from '../../../queries/projects';
import { lastPageIndex } from '../../../tools/table/pagination';
import { TablePaginaton } from '../../../ui/table/pagination';
import { SearchInput } from '../../../ui/table/search-input';
import { InviteForm } from '../invite-form/invite-form';
import {
  invitationColumns,
  invitationTableFeatures,
} from './invitation-columns';

@Component({
  selector: 'app-project-invitations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TitleCasePipe,
    NgIcon,
    FlexRender,
    TanStackTable,
    TablePaginaton,
    SearchInput,
    InviteForm,
    HlmTableImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSpinnerImports,
  ],
  providers: [provideIcons({ lucideX })],
  host: { class: 'grid gap-4' },
  templateUrl: './project-invitations.html',
})
export class ProjectInvitations {
  readonly projectId = input.required<string>();
  private readonly projects = inject(ProjectsData);
  private readonly sessionId = injectAuthSessionId();
  private readonly scopeIdentity = computed(() => ({
    projectId: this.projectId(),
    sessionId: this.sessionId(),
  }));
  readonly columns = invitationColumns;
  readonly search = linkedSignal(() => {
    this.projectId();
    return '';
  });
  private readonly debouncedSearch = debounced(this.search, 300);
  readonly sorting = linkedSignal<SortingState>(() => {
    this.projectId();
    return [{ id: 'createdAt', desc: true }];
  });
  readonly busy = linkedSignal(() => {
    this.projectId();
    this.sessionId();
    return false;
  });
  private readonly operation = signal(0);
  readonly pagination = linkedSignal({
    source: () => [
      this.projectId(),
      this.sessionId(),
      this.debouncedSearch.value(),
      this.sorting(),
    ],
    computation: (_, previous): PaginationState => ({
      pageIndex: 0,
      pageSize: previous?.value.pageSize ?? 20,
    }),
  });
  readonly invitations = injectQuery(() => {
    const { pageIndex, pageSize } = this.pagination();
    const sort = this.sorting()[0];
    const input = {
      projectId: this.projectId(),
      offset: pageIndex * pageSize,
      limit: pageSize,
      search: this.debouncedSearch.value() ?? '',
      sortBy:
        sort && isInvitationSortField(sort.id)
          ? sort.id
          : ('createdAt' as const),
      sortDirection: sort?.desc ? ('desc' as const) : ('asc' as const),
    };
    return this.projects.invitations(this.sessionId(), input);
  });
  readonly table = injectTable(() => ({
    key: 'project-invitations',
    features: invitationTableFeatures,
    columns: invitationColumns,
    data: this.invitations.isError()
      ? []
      : (this.invitations.data()?.invitations ?? []),
    rowCount: this.invitations.data()?.total ?? 0,
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

  async refresh(
    sessionId = this.sessionId(),
    projectId = this.projectId(),
    invalidate = true,
    scopeIdentity = this.scopeIdentity(),
  ) {
    if (invalidate)
      await this.projects.invalidateInvitations(sessionId, projectId);
    if (
      scopeIdentity !== this.scopeIdentity() ||
      this.sessionId() !== sessionId ||
      this.projectId() !== projectId
    )
      return;
    const lastPage = lastPageIndex(
      this.invitations.data()?.total ?? 0,
      this.pagination().pageSize,
    );
    if (this.pagination().pageIndex > lastPage)
      this.pagination.update((page) => ({ ...page, pageIndex: lastPage }));
  }

  async cancel(invitationId: string) {
    if (this.busy()) return;
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    const scopeIdentity = this.scopeIdentity();
    const operation = this.operation() + 1;
    this.operation.set(operation);
    const ownsView = () =>
      operation === this.operation() &&
      scopeIdentity === this.scopeIdentity() &&
      this.projectId() === projectId &&
      this.sessionId() === sessionId;
    this.busy.set(true);
    try {
      await this.projects.cancelInvitation(projectId, invitationId);
      await this.refresh(sessionId, projectId, true, scopeIdentity);
      if (!ownsView()) return;
      toast.success('Invitation cancelled.');
    } catch (error) {
      if (ownsView())
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not cancel the invitation.',
        );
    } finally {
      if (ownsView()) this.busy.set(false);
    }
  }
}
