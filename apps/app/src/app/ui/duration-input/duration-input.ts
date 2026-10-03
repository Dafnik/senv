import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import {
  type FormValueControl,
  type ValidationError,
} from '@angular/forms/signals';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';

export const durationUnits = [
  { value: 'seconds', label: 'Seconds', seconds: 1 },
  { value: 'hours', label: 'Hours', seconds: 3600 },
  { value: 'days', label: 'Days', seconds: 86400 },
  { value: 'months', label: 'Months', seconds: 2592000 },
] as const;

@Component({
  selector: 'app-duration-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmInputImports, HlmNativeSelectImports],
  host: { class: 'block min-w-0' },
  template: `
    <div class="flex gap-2">
      <input
        hlmInput
        class="min-w-0 flex-1"
        type="number"
        [step]="secondsOnly() ? 1 : 'any'"
        [attr.min]="min() === undefined ? null : min()! / multiplier()"
        [attr.max]="max() === undefined ? null : max()! / multiplier()"
        [id]="inputId()"
        [attr.aria-label]="label()"
        [value]="amount()"
        [disabled]="disabled()"
        [readOnly]="readonly()"
        [attr.aria-invalid]="invalid()"
        (input)="updateAmount($event)"
        (blur)="touched.set(true)"
      />
      @if (!secondsOnly()) {
        <hlm-native-select
          class="shrink-0"
          [selectId]="inputId() + '-unit'"
          [value]="unit()"
          [disabled]="disabled() || readonly()"
          (valueChange)="setUnit($event)"
        >
          @for (option of units(); track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </hlm-native-select>
      }
    </div>
    @if (!secondsOnly()) {
      <label class="sr-only" [for]="inputId() + '-unit'"
        >{{ label() }} unit</label
      >
    }
    @if (unit() === 'months') {
      <p class="text-muted-foreground mt-1 text-xs">1 month = 30 days.</p>
    }
    @if (min() !== undefined && max() !== undefined) {
      <p class="text-muted-foreground mt-1 text-xs">
        Allowed: {{ min() }}–{{ max() }} seconds.
      </p>
    }
    @if (touched()) {
      @for (error of errors(); track error) {
        <p class="text-destructive mt-1 text-sm" role="alert">
          {{ error.message || 'Enter a duration within the allowed range.' }}
        </p>
      }
    }
  `,
})
export class DurationInput implements FormValueControl<number> {
  readonly inputId = input.required<string>();
  readonly label = input('Duration');
  readonly value = model(0);
  readonly disabled = input(false);
  readonly readonly = input(false);
  readonly invalid = input(false);
  readonly touched = model(false);
  readonly errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  readonly min = input<number>();
  readonly max = input<number>();
  readonly secondsOnly = input(false);
  readonly units = computed(() =>
    durationUnits.filter(
      (option) => this.max() === undefined || option.seconds <= this.max()!,
    ),
  );
  readonly unit = signal<string>('seconds');
  readonly multiplier = computed(() =>
    this.secondsOnly()
      ? 1
      : (this.units().find((option) => option.value === this.unit())?.seconds ??
        1),
  );
  readonly amount = computed(() => this.value() / this.multiplier());
  setUnit(unit: string | null | undefined) {
    if (
      this.secondsOnly() ||
      !this.units().some((option) => option.value === unit)
    )
      return;
    this.unit.set(unit!);
  }
  updateAmount(event: Event) {
    const input = event.target as HTMLInputElement;
    this.value.set(
      input.value === '' ? NaN : Number(input.value) * this.multiplier(),
    );
  }
}
