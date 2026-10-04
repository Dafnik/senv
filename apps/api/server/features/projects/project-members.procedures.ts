import { authedProcedure } from '../../trpc/trpc';
import {
  changeMemberRole,
  changeMemberRoleInputSchema,
  removeMember,
  removeMemberInputSchema,
  rename,
  renameInputSchema,
} from './services/members';

export const projectMemberProcedures = {
  rename: authedProcedure
    .input(renameInputSchema)
    .mutation(({ ctx, input }) => rename(ctx.user, ctx.req.headers, input)),
  changeMemberRole: authedProcedure
    .input(changeMemberRoleInputSchema)
    .mutation(({ ctx, input }) => changeMemberRole(ctx.user, ctx.req.headers, input)),
  removeMember: authedProcedure
    .input(removeMemberInputSchema)
    .mutation(({ ctx, input }) => removeMember(ctx.user, ctx.req.headers, input)),
};
