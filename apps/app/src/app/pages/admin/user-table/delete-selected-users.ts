import type { WritableSignal } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';

type SelectedUserRow = { id: string; original: { id: string } };

export async function deleteSelectedUsers(options: {
  busy: WritableSignal<boolean>;
  rows: SelectedUserRow[];
  remove: (userId: string) => Promise<unknown>;
  clearRow: (rowId: string) => void;
  invalidate: () => Promise<unknown>;
  closeDialog: () => void;
}) {
  if (options.busy()) return;
  options.busy.set(true);
  const failures: string[] = [];
  try {
    for (const row of options.rows) {
      try {
        await options.remove(row.original.id);
        options.clearRow(row.id);
      } catch (error) {
        failures.push(
          error instanceof Error ? error.message : 'The request failed.',
        );
      }
    }
    if (failures.length) {
      const count = failures.length;
      toast.error(
        `Could not delete ${count} ${count === 1 ? 'user' : 'users'}. ${failures[0]}`,
      );
    } else {
      options.closeDialog();
    }
    await options.invalidate();
  } finally {
    options.busy.set(false);
  }
}
