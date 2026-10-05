import { computed, signal } from '@angular/core';
import { formatBytes } from '../../../../ui/format-bytes';

export class PublicationSourceFiles {
  readonly archiveFile = signal<File | null>(null);
  readonly directoryFiles = signal<FileList | null>(null);
  readonly selectedFileLabel = computed(() => {
    const archive = this.archiveFile();
    const files = this.directoryFiles();
    if (archive) return `${archive.name} (${formatBytes(archive.size)})`;
    if (files?.length) {
      const size = Array.from(files).reduce(
        (total, file) => total + file.size,
        0,
      );
      return `${files.length} files (${formatBytes(size)})`;
    }
    return '';
  });

  selectArchive(event: Event, onChange: () => void) {
    this.archiveFile.set(
      (event.target as HTMLInputElement).files?.item(0) ?? null,
    );
    this.directoryFiles.set(null);
    onChange();
  }

  selectDirectory(event: Event, onChange: () => void) {
    const files = (event.target as HTMLInputElement).files;
    this.directoryFiles.set(files?.length ? files : null);
    this.archiveFile.set(null);
    onChange();
  }

  clear() {
    this.archiveFile.set(null);
    this.directoryFiles.set(null);
  }
}
