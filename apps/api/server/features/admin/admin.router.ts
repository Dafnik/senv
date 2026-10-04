import { instanceDeploymentDefaultsSchema } from '../../../shared/deployments';
import { adminProcedure, router } from '../../trpc/trpc';
import {
  getInstanceDeploymentDefaults,
  updateInstanceDeploymentDefaults,
} from './services/deployment-defaults';
import { getInstanceStats } from './services/stats';

export const adminRouter = router({
  deploymentDefaults: adminProcedure.query(() => getInstanceDeploymentDefaults()),
  updateDeploymentDefaults: adminProcedure
    .input(instanceDeploymentDefaultsSchema)
    .mutation(({ input }) => updateInstanceDeploymentDefaults(input)),
  stats: adminProcedure.query(() => getInstanceStats()),
});
