import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { DurationInput } from '../../../../ui/duration-input/duration-input';
import type { SettingsModel } from '../project-deployment-settings.model';

@Component({
  selector: 'app-deployment-settings-routes-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    DurationInput,
    HlmButtonImports,
    HlmFieldImports,
    HlmInputImports,
  ],
  templateUrl: './routes-fields.html',
  styleUrl: '../deployment-settings-fields.css',
})
export class DeploymentSettingsRoutesFields {
  readonly settingsForm = input.required<FieldTree<SettingsModel>>();
  readonly routePreview = input.required<(index: number) => string>();
  readonly canManage = input(false);
  readonly saving = input(false);
  readonly addRoute = output<void>();
  readonly removeRoute = output<number>();
}
