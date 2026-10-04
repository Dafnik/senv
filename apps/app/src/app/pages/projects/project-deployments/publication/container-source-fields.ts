import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  Signal,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import type { PublishDraft } from '../project-deployments.form';

export type RegistryCredentialOption = {
  id: string;
  name: string;
  registry: string;
};

@Component({
  selector: 'app-deployment-container-source-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
  ],
  templateUrl: './container-source-fields.html',
  styles: [':host { display: block; }'],
})
export class ContainerSourceFields {
  readonly publishForm = input.required<FieldTree<PublishDraft>>();
  readonly busy = input(false);
  readonly credentials =
    input.required<Signal<RegistryCredentialOption[] | undefined>>();
  readonly registryCredentialId = input.required<Signal<string>>();
  readonly keepCapturedCredential = input.required<string>();
  readonly capturedCredentialLabel =
    input.required<Signal<string | undefined>>();
  readonly imageInput = output<Event>();
  readonly credentialSelection = output<Event>();
}
