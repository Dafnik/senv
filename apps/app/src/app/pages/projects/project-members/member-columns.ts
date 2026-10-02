import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
} from '@tanstack/angular-table';
import { TableHeadSortButton } from '../../../ui/table/sort-header-button';

export interface ProjectMember {
  id: string;
  userId: string;
  role: string;
  invitedByName?: string | null;
  user: { name: string; email: string };
}

export const memberTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text },
  columnMeta: {} as { label: string },
});
const column = createColumnHelper<typeof memberTableFeatures, ProjectMember>();

export const memberColumns = column.columns([
  column.accessor((member) => member.user.name, {
    id: 'name',
    header: () => TableHeadSortButton,
    meta: { label: 'Name' },
    sortFn: 'text',
  }),
  column.accessor((member) => member.user.email, {
    id: 'email',
    header: () => TableHeadSortButton,
    meta: { label: 'Email' },
    sortFn: 'text',
  }),
  column.accessor((member) => member.invitedByName ?? 'Not recorded', {
    id: 'invitedBy',
    header: () => TableHeadSortButton,
    meta: { label: 'Invited by' },
    sortFn: 'text',
  }),
  column.accessor('role', {
    header: () => TableHeadSortButton,
    meta: { label: 'Role' },
    sortFn: 'text',
  }),
]);

export const memberActionsColumn = column.display({
  id: 'actions',
  header: 'Actions',
  enableSorting: false,
});
