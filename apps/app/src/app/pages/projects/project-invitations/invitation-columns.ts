import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/angular-table';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../../../api/server/trpc/routers';
import { TableHeadSortButton } from '../../../ui/table/sort-header-button';

export type ProjectInvitation =
  inferRouterOutputs<AppRouter>['projects']['invitations']['invitations'][number];
export const invitationTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: {} as { label: string },
});
const column = createColumnHelper<
  typeof invitationTableFeatures,
  ProjectInvitation
>();
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const invitationColumns = column.columns([
  column.accessor('email', {
    header: () => TableHeadSortButton,
    meta: { label: 'Email' },
  }),
  column.accessor('role', {
    header: () => TableHeadSortButton,
    meta: { label: 'Role' },
  }),
  column.accessor('invitedByName', {
    header: () => TableHeadSortButton,
    meta: { label: 'Invited by' },
  }),
  column.accessor('createdAt', {
    header: () => TableHeadSortButton,
    meta: { label: 'Sent' },
    cell: (info) => dateFormatter.format(new Date(info.getValue())),
  }),
  column.accessor('expiresAt', {
    header: () => TableHeadSortButton,
    meta: { label: 'Expires' },
    cell: (info) => dateFormatter.format(new Date(info.getValue())),
  }),
  column.display({ id: 'actions', header: 'Actions', enableSorting: false }),
]);
