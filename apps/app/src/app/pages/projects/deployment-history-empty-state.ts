import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

@Component({
  selector: 'app-deployment-history-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButtonImports, HlmEmptyImports, HlmSpinnerImports],
  templateUrl: './deployment-history-empty-state.html',
})
export class DeploymentHistoryEmptyState {
  readonly isError = input(false);
  readonly isPending = input(false);
  readonly hasFilters = input(false);
  readonly errorMessage = input('');
  readonly retry = output<void>();
}
