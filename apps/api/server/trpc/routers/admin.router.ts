import { and, count, gte, lt } from 'drizzle-orm';
import { user } from '../../../../../drizzle/schema';
import { db } from '../../utils/db';
import { adminProcedure, router } from '../trpc';
import { instanceDeploymentDefaultsSchema } from '../../../shared/deployments';
import {
  getInstanceDeploymentDefaults,
  updateInstanceDeploymentDefaults,
} from '../../utils/deployments';

export const adminRouter = router({
  deploymentDefaults: adminProcedure.query(() => getInstanceDeploymentDefaults()),
  updateDeploymentDefaults: adminProcedure
    .input(instanceDeploymentDefaultsSchema)
    .mutation(({ input }) => updateInstanceDeploymentDefaults(input)),
  stats: adminProcedure.query(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const totalUsers = db.select({ count: count() }).from(user).get()!.count;
    const newUsersLast7Days = db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, sevenDaysAgo))
      .get()!.count;
    const newUsersPrior7Days = db
      .select({ count: count() })
      .from(user)
      .where(and(gte(user.createdAt, fourteenDaysAgo), lt(user.createdAt, sevenDaysAgo)))
      .get()!.count;

    const newUsersTrend =
      newUsersPrior7Days === 0
        ? 0
        : Math.round(((newUsersLast7Days - newUsersPrior7Days) / newUsersPrior7Days) * 100);

    return {
      totalUsers,
      newUsersLast7Days,
      newUsersTrend,
    };
  }),
});
