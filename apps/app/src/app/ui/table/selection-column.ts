import { Component, computed } from '@angular/core';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import {
  injectTableCellContext,
  injectTableContext,
} from '@tanstack/angular-table';

@Component({
  imports: [HlmCheckboxImports],
  host: {
    class: 'flex',
  },
  template: `
    <hlm-checkbox
      aria-label="Select all rows on this page"
      [checked]="table().getIsAllRowsSelected()"
      [indeterminate]="
        table().getIsSomeRowsSelected() && !table().getIsAllPageRowsSelected()
      "
      (checkedChange)="table().toggleAllPageRowsSelected($event)"
    />
  `,
})
export class TableHeadSelection {
  readonly table = injectTableContext();
}

@Component({
  imports: [HlmCheckboxImports],
  host: {
    class: 'flex',
  },
  template: `
    <hlm-checkbox
      [aria-label]="'Select row ' + cell().row.id"
      [disabled]="disabled()"
      [checked]="cell().row.getIsSelected()"
      (checkedChange)="cell().row.toggleSelected($event)"
    />
  `,
})
export class TableRowSelection {
  readonly cell = injectTableCellContext();

  readonly disabled = computed(() => !this.cell().row.getCanSelect());
}
