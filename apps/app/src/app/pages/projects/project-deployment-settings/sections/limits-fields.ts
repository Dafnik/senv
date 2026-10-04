import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import type { SettingsModel } from '../project-deployment-settings.model';

@Component({
  selector: 'app-deployment-settings-limits-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, HlmFieldImports, HlmInputImports],
  templateUrl: './limits-fields.html',
  styleUrl: '../deployment-settings-fields.css',
})
export class DeploymentSettingsLimitsFields {
  readonly settingsForm = input.required<FieldTree<SettingsModel>>();
  readonly isAdmin = input(false);
  readonly saving = input(false);
}
