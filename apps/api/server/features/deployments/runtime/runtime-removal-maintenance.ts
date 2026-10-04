import type { RuntimeServices } from './contracts';
import type { RuntimeLogCollector } from './log-collector';

export async function recoverPendingDeploymentRemovals(
  services: RuntimeServices,
  logs: RuntimeLogCollector,
): Promise<void> {
  await logs.loadCursors();
  await services
    .resumePendingDeploymentRemovals()
    .catch((error) =>
      console.error(
        '[deployment-runtime] pending removal recovery failed; the service preserved the records for retry',
        error,
      ),
    );
}

export async function retryDeploymentRemovals(services: RuntimeServices): Promise<void> {
  await services.cleanupDueDeployments().catch((error) => {
    console.error('[deployment-runtime] due deployment cleanup failed', error);
  });
  await services.resumePendingDeploymentRemovals().catch((error) => {
    console.error('[deployment-runtime] pending deployment removal retry failed', error);
  });
}
