export function containerName(
  instanceId: string,
  deploymentId: string,
  role: 'origin' | 'proxy',
): string {
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(instanceId) ||
    !/^[a-zA-Z0-9_-]+$/.test(deploymentId)
  )
    throw new Error('Invalid senv container identity.');
  return `senv-${instanceId}-${deploymentId}-${role}`;
}
