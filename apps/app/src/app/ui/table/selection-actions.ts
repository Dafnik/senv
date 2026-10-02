import { Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2 } from '@ng-icons/lucide';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';

@Component({
  selector: 'app-table-selection-actions',
  imports: [HlmButtonImports, HlmAlertDialogImports, NgIcon],
  providers: [provideIcons({ lucideTrash2 })],
  host: { class: 'flex items-center gap-2' },
  template: `
    <p class="text-sm font-medium">{{ label() }} selected</p>

    <button
      hlmBtn
      size="sm"
      variant="destructive"
      [hlmAlertDialogTriggerFor]="deleteDialog"
      [disabled]="pending()"
    >
      <ng-icon name="lucideTrash2" />
      Delete
    </button>

    <hlm-alert-dialog #deleteDialog="hlmAlertDialog">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h2 hlmAlertDialogTitle>Delete selected rows?</h2>
          <p hlmAlertDialogDescription>
            {{ confirmationMessage() }} This action cannot be undone.
          </p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel [disabled]="pending()">Cancel</button>
          <button
            hlmAlertDialogAction
            variant="destructive"
            [disabled]="pending()"
            (click)="confirm(ctx)"
          >
            Delete
          </button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class TableSelectionActions {
  readonly count = input.required<number>();
  readonly pending = input(false);
  readonly confirmed = output<() => void>();

  protected readonly label = computed(() =>
    this.count() === 1 ? '1 item' : `${this.count()} items`,
  );

  protected readonly confirmationMessage = computed(() =>
    this.count() === 1
      ? 'Are you sure you want to permanently delete the selected item?'
      : `Are you sure you want to permanently delete the ${this.count()} selected items?`,
  );

  protected confirm(dialog: { close: () => void }) {
    this.confirmed.emit(() => dialog.close());
  }
}
