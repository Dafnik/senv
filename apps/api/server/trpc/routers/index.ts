import { authedProcedure, router } from '../trpc';
import { adminRouter } from './admin.router';
import { projectsRouter } from './projects.router';
import { deploymentsRouter } from './deployments.router';

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
