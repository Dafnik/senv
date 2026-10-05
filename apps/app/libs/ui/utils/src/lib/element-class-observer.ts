import { isPlatformBrowser } from '@angular/common';
import type { ElementClassManager } from './element-class-manager.types';
import { hlm, toClassList } from './class-normalization';

const elementClassManagers = new WeakMap<HTMLElement, ElementClassManager>();
const observedElements = new Set<HTMLElement>();
let globalObserver: MutationObserver | null = null;

export function getElementClassManager(element: HTMLElement) {
  return elementClassManagers.get(element);
}

export function trackElementClassManager(
  manager: ElementClassManager,
  platformId: object,
) {
  elementClassManagers.set(manager.element, manager);
  observedElements.add(manager.element);
  setupGlobalObserver(platformId);
}

export function updateElementClasses(manager: ElementClassManager): void {
  if (manager.isUpdating) return;

  manager.isUpdating = true;
  if (!manager.hasInitialized && manager.sources.size > 0) {
    const currentClasses = toClassList(manager.element.className);
    const sourceClasses = collectSourceClasses(manager);

    for (const className of currentClasses) {
      if (!sourceClasses.has(className)) manager.baseClasses.add(className);
    }

    manager.hasInitialized = true;
  }

  const orderedClasses = [...manager.sources.values()]
    .sort((first, second) => first.order - second.order)
    .flatMap((source) => [...source.classes]);
  const classesToApply =
    orderedClasses.length > 0 || manager.baseClasses.size > 0
      ? hlm([...orderedClasses, ...manager.baseClasses])
      : '';

  if (manager.element.className !== classesToApply) {
    manager.element.className = classesToApply;
  }
  manager.isUpdating = false;
}

export function cleanupElementClassManager(element: HTMLElement): void {
  observedElements.delete(element);
  elementClassManagers.delete(element);

  if (observedElements.size === 0 && globalObserver) {
    globalObserver.disconnect();
    globalObserver = null;
  }
}

function setupGlobalObserver(platformId: object): void {
  if (!isPlatformBrowser(platformId) || globalObserver) return;

  globalObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type !== 'attributes' ||
        mutation.attributeName !== 'class'
      ) {
        continue;
      }

      const element = mutation.target as HTMLElement;
      const manager = elementClassManagers.get(element);
      if (!manager || !observedElements.has(element) || manager.isUpdating) {
        continue;
      }

      const sourceClasses = collectSourceClasses(manager);
      manager.baseClasses.clear();
      for (const className of toClassList(element.className)) {
        if (!sourceClasses.has(className)) manager.baseClasses.add(className);
      }
      updateElementClasses(manager);
    }
  });

  globalObserver.observe(document, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  });
}

function collectSourceClasses(manager: ElementClassManager) {
  const classes = new Set<string>();
  for (const source of manager.sources.values()) {
    for (const className of source.classes) classes.add(className);
  }
  return classes;
}
