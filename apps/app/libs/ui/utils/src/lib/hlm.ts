import {
  DestroyRef,
  effect,
  ElementRef,
  HostAttributeToken,
  inject,
  Injector,
  PLATFORM_ID,
  runInInjectionContext,
} from '@angular/core';
import type { ClassValue } from 'clsx';
import {
  registerClassSource,
  unregisterClassSource,
  updateClassSource,
} from './element-class-manager';

export { hlm } from './class-normalization';

/**
 * Add and remove dynamic classes without interfering with other class bindings.
 * Existing host classes are preserved, and multiple calls on one element merge
 * in registration order.
 */
export function classes(
  computed: () => ClassValue[] | string,
  options: ClassesOptions = {},
) {
  runInInjectionContext(options.injector ?? inject(Injector), () => {
    const elementRef = options.elementRef ?? inject(ElementRef);
    const platformId = inject(PLATFORM_ID);
    const destroyRef = inject(DestroyRef);
    const baseClasses = inject(new HostAttributeToken('class'), {
      optional: true,
    });
    const registration = registerClassSource(
      elementRef.nativeElement,
      baseClasses,
      platformId,
    );

    const update = () => updateClassSource(registration, computed());
    destroyRef.onDestroy(() => unregisterClassSource(registration));
    effect(update);
  });
}

interface ClassesOptions {
  elementRef?: ElementRef<HTMLElement>;
  injector?: Injector;
}
