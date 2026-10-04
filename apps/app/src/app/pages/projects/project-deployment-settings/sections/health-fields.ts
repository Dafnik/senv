import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { DurationInput } from '../../../../ui/duration-input/duration-input';
import type { SettingsModel } from '../project-deployment-settings.model';

@Component({
  selector: 'app-deployment-settings-health-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, DurationInput, HlmFieldImports, HlmInputImports],
  templateUrl: './health-fields.html',
  styleUrl: '../deployment-settings-fields.css',
})
export class DeploymentSettingsHealthFields {
  readonly settingsForm = input.required<FieldTree<SettingsModel>>();
  readonly canManage = input(false);
  readonly saving = input(false);
}
