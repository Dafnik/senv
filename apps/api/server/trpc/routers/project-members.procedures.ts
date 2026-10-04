import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import * as z from 'zod';
import { member, organization } from '../../../../../drizzle/schema';
import { projectNameSchema } from '../../../shared/validation';
import { projectRoleNames } from '../../../shared/project-permissions';
import { db } from '../../utils/db';
import { auth } from '../../utils/auth';
import { assertProjectAccess } from '../../utils/project-access';
import { authedProcedure } from '../trpc';

const projectInput = z.object({ projectId: z.string().min(1) });
const roleInput = z.enum(projectRoleNames);

export const projectMemberProcedures = {
  rename: authedProcedure
    .input(projectInput.extend({ name: projectNameSchema }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'admin');
      if (ctx.user.role !== 'admin')
        return auth.api.updateOrganization({
          headers: ctx.req.headers,
          body: { organizationId: input.projectId, data: { name: input.name } },
        });
      return db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, input.projectId))
        .returning()
        .get();
    }),
  changeMemberRole: authedProcedure
    .input(projectInput.extend({ memberId: z.string().min(1), role: roleInput }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'admin');
      if (ctx.user.role !== 'admin')
        return auth.api.updateMemberRole({
          headers: ctx.req.headers,
          body: { organizationId: input.projectId, memberId: input.memberId, role: input.role },
        });
      const updated = db
        .update(member)
        .set({ role: input.role })
        .where(and(eq(member.id, input.memberId), eq(member.organizationId, input.projectId)))
        .returning()
        .get();
      if (!updated)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this project.' });
      return updated;
    }),
  removeMember: authedProcedure
    .input(projectInput.extend({ memberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'admin');
      const target = db
        .select()
        .from(member)
        .where(and(eq(member.id, input.memberId), eq(member.organizationId, input.projectId)))
        .get();
      if (!target)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this project.' });
      if (ctx.user.role !== 'admin')
        return auth.api.removeMember({
          headers: ctx.req.headers,
          body: { organizationId: input.projectId, memberIdOrEmail: target.id },
        });
      db.delete(member)
        .where(and(eq(member.id, target.id), eq(member.organizationId, input.projectId)))
        .run();
      return { success: true };
    }),
};
