import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  Signal,
} from '@angular/core';
import { FieldTree, FormField, FormRoot } from '@angular/forms/signals';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

@Component({
  selector: 'app-project-identity-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
  ],
  templateUrl: './identity.html',
  styles: [':host { display: block; }'],
})
export class ProjectIdentitySettings {
  readonly isAdmin = input(false);
  readonly previewSlug = input('');
  readonly slugForm = input.required<FieldTree<{ previewSlug: string }>>();
  readonly slugModel = input.required<Signal<{ previewSlug: string }>>();
  readonly savingSlug = input(false);
  readonly slugError = input('');
  readonly saveSlug = output<Event>();
  readonly discardSlug = output<void>();
}
