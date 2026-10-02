import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import * as z from 'zod';
import { invitation, member, organization } from '../../../../../drizzle/schema';
import { invitationSortFields, invitationStatuses } from '../../../shared/project-invitations';
import { db } from '../../utils/db';
import { authedProcedure, router } from '../trpc';

export const projectsRouter = router({
  list: authedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(40),
        cursor: z.object({ createdAt: z.number().int().nonnegative(), id: z.string() }).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const rows = db
        .select({ id: organization.id, name: organization.name, createdAt: organization.createdAt })
        .from(organization)
        .innerJoin(member, eq(member.organizationId, organization.id))
        .where(
          and(
            eq(member.userId, ctx.user.id),
            input.cursor
              ? or(
                  lt(organization.createdAt, new Date(input.cursor.createdAt)),
                  and(
                    eq(organization.createdAt, new Date(input.cursor.createdAt)),
                    lt(organization.id, input.cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(organization.createdAt), desc(organization.id))
        .limit(input.limit + 1)
        .all();
      const hasNextPage = rows.length > input.limit;
      const projects = rows.slice(0, input.limit);
      const last = projects[projects.length - 1];
      return {
        projects,
        // Numeric timestamps survive Angular's SSR transfer cache without Date conversion.
        nextCursor:
          hasNextPage && last ? { createdAt: last.createdAt.getTime(), id: last.id } : null,
      };
    }),
  invitations: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().trim().max(254).default(''),
        status: z.enum(invitationStatuses).optional(),
        sortBy: z.enum(invitationSortFields).default('createdAt'),
        sortDirection: z.enum(['asc', 'desc']).default('desc'),
      }),
    )
    .query(({ ctx, input }) => {
      const membership = db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, input.projectId), eq(member.userId, ctx.user.id)))
        .get();
      if (membership?.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });

      const status = sql<string>`case when ${invitation.status} = 'pending' and ${invitation.expiresAt} < ${Date.now()} then 'expired' else ${invitation.status} end`;
      const filter = and(
        eq(invitation.organizationId, input.projectId),
        input.search
          ? sql`instr(lower(${invitation.email}), ${input.search.toLowerCase()}) > 0`
          : undefined,
        input.status ? eq(status, input.status) : undefined,
      );
      const sortColumn = input.sortBy === 'status' ? status : invitation[input.sortBy];
      const invitations = db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status,
          createdAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
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
});
