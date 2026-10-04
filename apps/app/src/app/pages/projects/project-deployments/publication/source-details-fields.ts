import {
  ChangeDetectionStrategy,
  Component,
  input,
  Signal,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import type { PublishDraft } from '../project-deployments.form';

@Component({
  selector: 'app-deployment-source-details-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, HlmCheckboxImports, HlmFieldImports, HlmInputImports],
  templateUrl: './source-details-fields.html',
  styles: [':host { display: block; }'],
})
export class SourceDetailsFields {
  readonly publishForm = input.required<FieldTree<PublishDraft>>();
  readonly projectSettings =
    input.required<Signal<{ repository: string } | undefined>>();
}
