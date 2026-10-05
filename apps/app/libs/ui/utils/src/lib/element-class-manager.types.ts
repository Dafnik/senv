export interface ElementClassManager {
  element: HTMLElement;
  sources: Map<number, { classes: Set<string>; order: number }>;
  baseClasses: Set<string>;
  isUpdating: boolean;
  nextOrder: number;
  hasInitialized: boolean;
  restoreRafId: number | null;
  transitionsSuppressed: boolean;
  previousTransition: string;
  previousTransitionPriority: string;
}

export interface ClassSourceRegistration {
  manager: ElementClassManager;
  sourceId: number;
  sourceOrder: number;
}
