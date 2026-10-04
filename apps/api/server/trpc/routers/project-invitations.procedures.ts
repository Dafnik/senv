import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import * as z from 'zod';
import { invitation, organization, user } from '../../../../../drizzle/schema';
import { invitationSortFields } from '../../../shared/project-invitations';
import { projectRoleNames } from '../../../shared/project-permissions';
import { emailAddressSchema } from '../../../shared/validation';
import { db } from '../../utils/db';
import { auth } from '../../utils/auth';
import { assertProjectAccess } from '../../utils/project-access';
import {
  createAndDeliverProjectInvitation,
  withProjectRecipientLock,
} from '../../utils/project-invitation-delivery';
import { authedProcedure } from '../trpc';

const projectInput = z.object({ projectId: z.string().min(1) });
const roleInput = z.enum(projectRoleNames);
export const projectInvitationProcedures = {
  invite: authedProcedure
    .input(
      projectInput.extend({
        email: emailAddressSchema,
        role: roleInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withProjectRecipientLock(input.projectId, input.email, async () => {
        const project = assertProjectAccess(input.projectId, ctx.user, 'admin');
        if (ctx.user.role !== 'admin')
          return auth.api.createInvitation({
            headers: ctx.req.headers,
            body: { organizationId: input.projectId, email: input.email, role: input.role },
          });
        return createAndDeliverProjectInvitation({
          projectId: input.projectId,
          email: input.email,
          role: input.role,
          inviterId: ctx.user.id,
          inviterName: ctx.user.name,
          projectName: project.name,
        });
      });
    }),
  cancelInvitation: authedProcedure
    .input(projectInput.extend({ invitationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'admin');
      const saved = db
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.id, input.invitationId),
            eq(invitation.organizationId, input.projectId),
          ),
        )
        .get();
      if (!saved) throw new TRPCError({ code: 'NOT_FOUND' });
      return withProjectRecipientLock(input.projectId, saved.email, () => {
        assertProjectAccess(input.projectId, ctx.user, 'admin');
        return ctx.user.role !== 'admin'
          ? auth.api.cancelInvitation({
              headers: ctx.req.headers,
              body: { invitationId: input.invitationId },
            })
          : db
              .update(invitation)
              .set({ status: 'canceled' })
              .where(eq(invitation.id, saved.id))
              .returning()
              .get();
      });
    }),
  invitation: authedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      if (!ctx.user.emailVerified)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Verify your email address first.' });
      const saved = db
        .select({
          organizationName: organization.name,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .where(
          and(
            eq(invitation.id, input.invitationId),
            eq(invitation.email, ctx.user.email.toLowerCase()),
            eq(invitation.status, 'pending'),
            gt(invitation.expiresAt, new Date()),
          ),
        )
        .get();
      if (!saved)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found or no longer open.',
        });
      return saved;
    }),
  invitations: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().trim().max(254).default(''),
        sortBy: z.enum(invitationSortFields).default('createdAt'),
        sortDirection: z.enum(['asc', 'desc']).default('desc'),
      }),
    )
    .query(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'admin');

      const filter = and(
        eq(invitation.organizationId, input.projectId),
        input.search
          ? sql`instr(lower(${invitation.email}), ${input.search.toLowerCase()}) > 0`
          : undefined,
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, new Date()),
      );
      const sortColumn = input.sortBy === 'invitedByName' ? user.name : invitation[input.sortBy];
      const invitations = db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          invitedById: invitation.inviterId,
          invitedByName: user.name,
          createdAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .innerJoin(user, eq(user.id, invitation.inviterId))
        .where(filter)
        .orderBy(
          input.sortDirection === 'asc' ? asc(sortColumn) : desc(sortColumn),
          desc(invitation.id),
        )
        .limit(input.limit)
        .offset(input.offset)
        .all();
      const total = db.select({ total: count() }).from(invitation).where(filter).get()!.total;
      return { invitations, total };
    }),
};
