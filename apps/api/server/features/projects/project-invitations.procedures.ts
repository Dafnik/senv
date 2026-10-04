import { authedProcedure } from '../../trpc/trpc';
import {
  cancelInvitation,
  cancelInvitationInputSchema,
  getInvitation,
  getInvitationInputSchema,
  invite,
  inviteInputSchema,
  listInvitations,
  listInvitationsInputSchema,
} from './services/invitations';

export const projectInvitationProcedures = {
  invite: authedProcedure
    .input(inviteInputSchema)
    .mutation(({ ctx, input }) => invite(ctx.user, ctx.req.headers, input)),
  cancelInvitation: authedProcedure
    .input(cancelInvitationInputSchema)
    .mutation(({ ctx, input }) => cancelInvitation(ctx.user, ctx.req.headers, input)),
  invitation: authedProcedure
    .input(getInvitationInputSchema)
    .query(({ ctx, input }) => getInvitation(ctx.user, input)),
  invitations: authedProcedure
    .input(listInvitationsInputSchema)
    .query(({ ctx, input }) => listInvitations(ctx.user, input)),
};
