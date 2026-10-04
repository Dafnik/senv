import { authedProcedure, router } from '../trpc';
import { adminRouter } from '../../features/admin/admin.router';
import { projectsRouter } from '../../features/projects/projects.router';
import { deploymentsRouter } from '../../features/deployments/deployments.router';

export const appRouter = router({
  admin: adminRouter,
  projects: projectsRouter,
  deployments: deploymentsRouter,
  me: authedProcedure.query(({ ctx }) => {
    return ctx.user;
  }),
});
// export type definition of API
export type AppRouter = typeof appRouter;
