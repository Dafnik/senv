import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  Signal,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import type { PublishDraft } from '../project-deployments.form';

@Component({
  selector: 'app-deployment-static-source-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, HlmFieldImports, HlmNativeSelectImports],
  templateUrl: './static-source-fields.html',
  styles: [':host { display: block; }'],
})
export class StaticSourceFields {
  readonly publishForm = input.required<FieldTree<PublishDraft>>();
  readonly busy = input(false);
  readonly archiveAccept = input.required<string>();
  readonly selectedFileLabel = input.required<Signal<string>>();
  readonly availableArtifacts = input.required<Signal<PublicDeployment[]>>();
  readonly archiveSelected = output<Event>();
  readonly directorySelected = output<Event>();
  readonly reuseSelection = output<Event>();
}
