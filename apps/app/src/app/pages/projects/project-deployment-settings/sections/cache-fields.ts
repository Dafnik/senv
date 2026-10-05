import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  Signal,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { DurationInput } from '../../../../ui/duration-input/duration-input';
import type { SettingsModel } from '../project-deployment-settings.model';

@Component({
  selector: 'app-deployment-settings-cache-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    DurationInput,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
  ],
  templateUrl: './cache-fields.html',
  styleUrl: '../deployment-settings-fields.css',
})
export class DeploymentSettingsCacheFields {
  readonly settingsForm = input.required<FieldTree<SettingsModel>>();
  readonly canManage = input(false);
  readonly saving = input(false);
  readonly model = input.required<Signal<SettingsModel>>();
  readonly addCacheRule = output<void>();
  readonly removeCacheRule = output<number>();
  readonly compressionEndingsInput = output<Event>();
}
