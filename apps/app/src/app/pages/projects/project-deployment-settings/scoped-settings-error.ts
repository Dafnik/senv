import { linkedSignal } from '@angular/core';

export function createSettingsScopeError(scope: () => object) {
  return linkedSignal(() => {
    scope();
    return '';
  });
}
