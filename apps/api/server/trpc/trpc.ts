import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { authorizeOperation, resolvePrincipal } from '../features/auth/services/request-principal';
import type { Context } from './context';

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const isAuthed = t.middleware(async ({ ctx, next, path, getRawInput }) => {
  const principal = await resolvePrincipal(ctx.req.headers);
  authorizeOperation(principal, path, await getRawInput());
  return next({ ctx: principal });
});

const isAdmin = isAuthed.unstable_pipe(async ({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next();
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const authedProcedure = t.procedure.use(isAuthed);
export const adminProcedure = t.procedure.use(isAdmin);
