import type { PublicDeployment } from '@senv/api/shared/deployments';

export function dateLabel(value: Date | string | null) {
  return value ? new Date(value).toLocaleString() : 'Not available';
}
export function isTerminal(deployment: PublicDeployment) {
  return deployment.status === 'deleted' || deployment.status === 'cleaned';
}
export function canReuseDeployment(
  deployment: Pick<
    PublicDeployment,
    'kind' | 'artifactId' | 'imageDigest' | 'status' | 'removalPending'
  >,
) {
  return (
    !deployment.removalPending &&
    deployment.status !== 'deleted' &&
    deployment.status !== 'cleaned' &&
    (deployment.kind === 'static'
      ? !!deployment.artifactId
      : !!deployment.imageDigest)
  );
}
export function canMutateDeployment(deployment: PublicDeployment) {
  return !isTerminal(deployment) && !deployment.removalPending;
}
export function statusVariant(
  status: PublicDeployment['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'healthy') return 'default';
  if (status === 'failed' || status === 'unhealthy') return 'destructive';
  return ['stopped', 'cleaned', 'deleted'].includes(status)
    ? 'secondary'
    : 'outline';
}
export function aliasUrl(deployment: PublicDeployment, label: string) {
  const url = new URL(deployment.previewUrl);
  url.hostname = label + url.hostname.slice(url.hostname.indexOf('.'));
  return url.href;
}
export function retentionInfo(deployment: PublicDeployment, now = Date.now()) {
  const days = deployment.config.retentionDays;
  if (isTerminal(deployment))
    return {
      label: 'Removed',
      context: 'History retained',
      description:
        'The runtime and artifacts have been removed. History remains available.',
      overdue: false,
      deadline: null,
    };
  if (deployment.removalPending)
    return {
      label: 'Removal pending',
      context: 'Cleanup in progress',
      description:
        'The runtime and artifacts are being removed. History will remain available.',
      overdue: false,
      deadline: null,
    };
  const protections = [
    deployment.pinned ? 'pinned' : '',
    deployment.tags.length ? 'tagged' : '',
    deployment.branchAlias ? 'selected for its branch' : '',
  ].filter(Boolean);
  if (protections.length)
    return {
      label: 'No expiry',
      context: protections.join(' · '),
      description: `Retained while ${protections.join(' or ')}. The ${days}-day expiry period starts when all protection is removed.`,
      overdue: false,
      deadline: null,
    };
  if (!deployment.retentionDeadlineAt)
    return {
      label: 'Awaiting startup',
      context: `${days}-day retention`,
      description: `The ${days}-day expiry period starts when the deployment becomes healthy.`,
      overdue: false,
      deadline: null,
    };
  const deadline = new Date(deployment.retentionDeadlineAt);
  const remaining = deadline.getTime() - now;
  const hours = Math.ceil(remaining / 3600000);
  const context =
    remaining <= 0
      ? 'Cleanup due'
      : hours < 24
        ? `${hours} ${hours === 1 ? 'hour' : 'hours'} remaining`
        : `${Math.ceil(hours / 24)} days remaining`;
  return {
    label: 'Expires',
    context,
    description: `After expiry, history remains available. Pin the deployment or assign a tag to prevent expiry.`,
    overdue: remaining <= 0,
    deadline,
  };
}
