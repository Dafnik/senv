import { isPlatformBrowser } from '@angular/common';
import type { ClassValue } from 'clsx';
import { toClassList } from './class-normalization';
import {
  cleanupElementClassManager,
  getElementClassManager,
  trackElementClassManager,
  updateElementClasses,
} from './element-class-observer';
import type {
  ClassSourceRegistration,
  ElementClassManager,
} from './element-class-manager.types';

let sourceCounter = 0;

export function registerClassSource(
  element: HTMLElement,
  baseClasses: string | null,
  platformId: object,
): ClassSourceRegistration {
  let manager = getElementClassManager(element);
  if (!manager) {
    manager = createManager(element, baseClasses, platformId);
  }

  return {
    manager,
    sourceId: sourceCounter++,
    sourceOrder: manager.nextOrder++,
  };
}

export function updateClassSource(
  registration: ClassSourceRegistration,
  classes: ClassValue[] | string,
) {
  const { manager, sourceId, sourceOrder } = registration;
  manager.sources.set(sourceId, {
    classes: new Set(toClassList(classes)),
    order: sourceOrder,
  });
  updateElementClasses(manager);

  if (manager.transitionsSuppressed) {
    manager.transitionsSuppressed = false;
    manager.restoreRafId = requestAnimationFrame(() => {
      manager.restoreRafId = null;
      restoreTransitionSuppression(manager);
    });
  }
}

export function unregisterClassSource(registration: ClassSourceRegistration) {
  const { manager, sourceId } = registration;
  const needsTransitionRestore =
    manager.transitionsSuppressed || manager.restoreRafId !== null;
  if (manager.restoreRafId !== null) {
    cancelAnimationFrame(manager.restoreRafId);
    manager.restoreRafId = null;
  }
  if (needsTransitionRestore) {
    manager.transitionsSuppressed = false;
    restoreTransitionSuppression(manager);
  }

  manager.sources.delete(sourceId);
  if (manager.sources.size === 0) {
    cleanupElementClassManager(manager.element);
  } else {
    updateElementClasses(manager);
  }
}

function createManager(
  element: HTMLElement,
  baseClasses: string | null,
  platformId: object,
): ElementClassManager {
  const manager: ElementClassManager = {
    element,
    sources: new Map(),
    baseClasses: new Set(baseClasses ? toClassList(baseClasses) : []),
    isUpdating: false,
    nextOrder: 0,
    hasInitialized: false,
    restoreRafId: null,
    transitionsSuppressed: false,
    previousTransition: '',
    previousTransitionPriority: '',
  };

  if (isPlatformBrowser(platformId)) {
    manager.previousTransition = element.style.getPropertyValue('transition');
    manager.previousTransitionPriority =
      element.style.getPropertyPriority('transition');
    element.style.setProperty('transition', 'none', 'important');
    manager.transitionsSuppressed = true;
  }
  trackElementClassManager(manager, platformId);
  return manager;
}

function restoreTransitionSuppression(manager: ElementClassManager) {
  if (manager.previousTransition) {
    manager.element.style.setProperty(
      'transition',
      manager.previousTransition,
      manager.previousTransitionPriority || undefined,
    );
  } else {
    manager.element.style.removeProperty('transition');
  }
}
