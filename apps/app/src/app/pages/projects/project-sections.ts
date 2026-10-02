export const projectSections = ['deployments', 'members', 'settings'] as const;
export type ProjectSection = (typeof projectSections)[number];
export const isProjectSection = (value: unknown): value is ProjectSection =>
  projectSections.some((section) => section === value);
