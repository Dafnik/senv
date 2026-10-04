export type ContainerRole = 'origin' | 'proxy';
export type ContainerOwner = { id: string; projectId: string };
export type OwnershipContainer = { Id: string; Config?: { Labels?: Record<string, string> } };

export class ContainerOwnershipError extends Error {
  constructor(containerId: string) {
    super(
      `Refusing to manage container ${containerId} because its ownership labels do not match this deployment.`,
    );
    this.name = 'ContainerOwnershipError';
  }
}

export function assertContainerOwned(
  container: OwnershipContainer,
  instanceId: string,
  owner: ContainerOwner,
  role: ContainerRole,
): void {
  const labels = container.Config?.Labels;
  if (
    labels?.['senv.managed'] !== 'true' ||
    labels['senv.instance'] !== instanceId ||
    labels['senv.deployment'] !== owner.id ||
    labels['senv.project'] !== owner.projectId ||
    labels['senv.role'] !== role
  )
    throw new ContainerOwnershipError(container.Id);
}
