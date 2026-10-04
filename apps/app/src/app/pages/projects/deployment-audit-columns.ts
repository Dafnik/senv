import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/angular-table';
import type { DeploymentAuditEntry } from '@senv/api/shared/deployments';
import { TableHeadSortButton } from '../../ui/table/sort-header-button';

export const deploymentAuditTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: {} as { label: string },
});

const column = createColumnHelper<
  typeof deploymentAuditTableFeatures,
  DeploymentAuditEntry
>();

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const deploymentIdColumn = column.accessor('deploymentId', {
  header: () => TableHeadSortButton,
  meta: { label: 'Deployment' },
  cell: (info) => info.getValue(),
});

const actorColumn = column.accessor((entry) => entry.actor?.name ?? 'System', {
  id: 'actor',
  header: () => TableHeadSortButton,
  meta: { label: 'Actor' },
});

const baseColumns = [
  column.accessor('createdAt', {
    header: () => TableHeadSortButton,
    meta: { label: 'Time' },
    cell: (info) => dateFormatter.format(new Date(info.getValue())),
  }),
  column.accessor('event', {
    header: () => TableHeadSortButton,
    meta: { label: 'Event' },
    cell: (info) => info.getValue().split('_').join(' '),
  }),
];

const detailColumn = column.accessor((entry) => entry.details, {
  id: 'details',
  header: 'Details',
  enableSorting: false,
});

export const deploymentAuditColumns = (includeDeployment: boolean) =>
  column.columns([
    ...baseColumns,
    ...(includeDeployment ? [deploymentIdColumn] : []),
    actorColumn,
    detailColumn,
  ]);
