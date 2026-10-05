import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideFolder,
  lucideFile,
  lucideFileCode,
  lucideFileText,
  lucideFileImage,
  lucideFileArchive,
  lucideFileJson,
  lucideFileAudio,
  lucideFileVideo,
  lucideFileSpreadsheet,
} from '@ng-icons/lucide';

export function artifactFileIcon(name: string, directory = false) {
  if (directory) return 'lucideFolder';
  const extension = name.toLowerCase().split('.').at(-1) ?? '';
  if (/^(png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?)$/.test(extension))
    return 'lucideFileImage';
  if (/^(zip|gz|tgz|tar|br|zst|7z|rar)$/.test(extension))
    return 'lucideFileArchive';
  if (/^(json|jsonc|map)$/.test(extension)) return 'lucideFileJson';
  if (
    /^(js|jsx|ts|tsx|mjs|cjs|css|scss|sass|less|html?|xml|wasm|sh|py|rb|go|java|kt|rs|vue)$/.test(
      extension,
    )
  )
    return 'lucideFileCode';
  if (/^(mp3|wav|ogg|flac|m4a|aac)$/.test(extension)) return 'lucideFileAudio';
  if (/^(mp4|webm|mov|avi|mkv)$/.test(extension)) return 'lucideFileVideo';
  if (/^(csv|tsv|xlsx?|ods)$/.test(extension)) return 'lucideFileSpreadsheet';
  if (/^(txt|md|mdx|pdf|log|ya?ml|toml|ini|conf|lock)$/.test(extension))
    return 'lucideFileText';
  return 'lucideFile';
}

@Component({
  selector: 'app-artifact-file-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  providers: [
    provideIcons({
      lucideFolder,
      lucideFile,
      lucideFileCode,
      lucideFileText,
      lucideFileImage,
      lucideFileArchive,
      lucideFileJson,
      lucideFileAudio,
      lucideFileVideo,
      lucideFileSpreadsheet,
    }),
  ],
  host: {
    class: 'text-muted-foreground inline-flex shrink-0',
    'aria-hidden': 'true',
  },
  template: '<ng-icon [name]="icon()" size="18" />',
})
export class ArtifactFileIcon {
  readonly name = input.required<string>();
  readonly directory = input(false);
  readonly icon = computed(() =>
    artifactFileIcon(this.name(), this.directory()),
  );
}
