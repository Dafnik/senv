import type { ClientContext } from '../api/client.ts';
import { sleep } from './timing.ts';
export async function waitForPublication(
  value: ClientContext,
  projectId: string,
  deploymentId: string,
  timeout: number,
  signal?: AbortSignal,
) {
  const expires = Date.now() + timeout * 1000;
  while (Date.now() < expires) {
    signal?.throwIfAborted();
    const status = await value.client.deployments.status.query(
      { projectId, deploymentId },
      { signal },
    );
    if (['healthy', 'failed', 'stopped', 'deleted', 'cleaned'].includes(status.status))
      return status;
    await sleep(Math.min(1000, expires - Date.now()), signal);
  }
  return { id: deploymentId, status: 'timeout' as const, failureReason: null };
}
