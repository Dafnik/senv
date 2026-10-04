import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { repositoryProviders } from '@senv/api/shared/deployments';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import type { SettingsModel } from '../project-deployment-settings.model';

@Component({
  selector: 'app-deployment-settings-source-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
  ],
  templateUrl: './source-fields.html',
  styleUrl: '../deployment-settings-fields.css',
})
export class DeploymentSettingsSourceFields {
  readonly settingsForm = input.required<FieldTree<SettingsModel>>();
  readonly canManage = input(false);
  readonly saving = input(false);
  readonly repositoryProviders = repositoryProviders;
}
