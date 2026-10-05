import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import * as z from 'zod';
import {
  automationToken,
  cliDeviceRequest,
  cliSession,
  deviceCode,
  session,
} from '../../../../../drizzle/schema';
import { db } from '../../infrastructure/db';
import env from '../../infrastructure/env';
import { authedProcedure, publicProcedure, router } from '../../trpc/trpc';
import { assertProjectAccess } from '../projects/services/access';
import { findProjectByPreviewSlug } from '../projects/repositories/projects';
import { hashToken, requirePersonal } from './services/request-principal';

const idInput = z.object({ id: z.string().min(1) });
export const cliRouter = router({
  access: authedProcedure.query(({ ctx }) =>
    ctx.automation
      ? {
          kind: 'automation' as const,
          projectId: ctx.automation.projectId,
          permission: ctx.automation.permission,
          impersonated: false,
          sessionId: null,
        }
      : {
          kind: 'personal' as const,
          projectId: null,
          permission: null,
          impersonated: Boolean(ctx.session?.impersonatedBy),
          sessionId: ctx.session?.id ?? null,
        },
  ),
  instance: publicProcedure.query(() => ({
    apiUrl: env.API_URL,
    appUrl: env.APP_URL,
    clientId: 'senv-cli',
  })),
  project: authedProcedure
    .input(z.object({ project: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const id = findProjectByPreviewSlug(input.project)?.id ?? input.project;
      if (ctx.automation && id !== ctx.automation.projectId)
        throw new TRPCError({ code: 'FORBIDDEN' });
      const project = assertProjectAccess(id, ctx.user);
      return { id: project.id, name: project.name, previewSlug: project.previewSlug };
    }),
  device: authedProcedure
    .input(z.object({ userCode: z.string().trim().min(1) }))
    .query(({ ctx, input }) => {
      requirePersonal(ctx);
      const code = db
        .select()
        .from(deviceCode)
        .where(eq(deviceCode.userCode, input.userCode.toUpperCase().replaceAll('-', '')))
        .get();
      if (
        !code ||
        code.expiresAt <= new Date() ||
        code.clientId !== 'senv-cli' ||
        (code.userId && code.userId !== ctx.user.id)
      )
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invalid or expired authorization code.',
        });
      const metadata = db
        .select()
        .from(cliDeviceRequest)
        .where(eq(cliDeviceRequest.id, code.id))
        .get();
      return {
        label: metadata?.label ?? 'senv CLI',
        version: metadata?.version ?? 'unknown',
        expiresAt: code.expiresAt,
        status: code.status,
        appUrl: env.APP_URL,
      };
    }),
  sessions: authedProcedure.query(({ ctx }) => {
    const current = requirePersonal(ctx);
    return db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        metadata: {
          label: cliSession.label,
          version: cliSession.version,
          lastActivityAt: cliSession.lastActivityAt,
        },
      })
      .from(session)
      .leftJoin(cliSession, eq(session.id, cliSession.id))
      .where(and(eq(session.userId, ctx.user.id), gt(session.expiresAt, new Date())))
      .orderBy(desc(session.createdAt))
      .all()
      .map(({ metadata, updatedAt, ...row }) => ({
        ...row,
        kind: metadata ? ('cli' as const) : ('browser' as const),
        label: metadata?.label ?? row.userAgent ?? 'Browser',
        version: metadata?.version ?? null,
        lastActivityAt: metadata?.lastActivityAt ?? updatedAt,
        current: row.id === current.id,
      }));
  }),
  revokeSession: authedProcedure.input(idInput).mutation(({ ctx, input }) => {
    requirePersonal(ctx);
    const removed = db
      .delete(session)
      .where(and(eq(session.id, input.id), eq(session.userId, ctx.user.id)))
      .returning({ id: session.id })
      .get();
    if (!removed) throw new TRPCError({ code: 'NOT_FOUND' });
    return { success: true };
  }),
  revokeOtherSessions: authedProcedure.mutation(({ ctx }) => {
    const current = requirePersonal(ctx);
    db.delete(session)
      .where(and(eq(session.userId, ctx.user.id), ne(session.id, current.id)))
      .run();
    return { success: true };
  }),
  tokens: authedProcedure.query(({ ctx }) => {
    requirePersonal(ctx);
    return db
      .select({
        id: automationToken.id,
        name: automationToken.name,
        prefix: automationToken.prefix,
        projectId: automationToken.projectId,
        permission: automationToken.permission,
        createdAt: automationToken.createdAt,
        expiresAt: automationToken.expiresAt,
        revokedAt: automationToken.revokedAt,
        lastUsedAt: automationToken.lastUsedAt,
      })
      .from(automationToken)
      .where(eq(automationToken.userId, ctx.user.id))
      .orderBy(desc(automationToken.createdAt))
      .all();
  }),
  createToken: authedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        projectId: z.string().min(1),
        permission: z.enum(['read', 'manage']),
        days: z.number().int().positive().optional(),
        expiresInSeconds: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      requirePersonal(ctx);
      assertProjectAccess(input.projectId, ctx.user, input.permission);
      const secret = `senv_at_${randomBytes(32).toString('base64url')}`;
      const id = randomUUID();
      if (input.days !== undefined && input.expiresInSeconds !== undefined)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose one token lifetime.' });
      const seconds =
        input.expiresInSeconds === undefined ? (input.days ?? 30) * 86400 : input.expiresInSeconds;
      const expiresAt = seconds === null ? null : new Date(Date.now() + seconds * 1000);
      if (expiresAt && !Number.isFinite(expiresAt.getTime()))
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Token lifetime exceeds the supported date range.',
        });
      db.insert(automationToken)
        .values({
          id,
          name: input.name,
          projectId: input.projectId,
          permission: input.permission,
          userId: ctx.user.id,
          tokenHash: hashToken(secret),
          prefix: secret.slice(0, 16),
          expiresAt,
        })
        .run();
      return { id, secret, expiresAt };
    }),
  revokeToken: authedProcedure.input(idInput).mutation(({ ctx, input }) => {
    requirePersonal(ctx);
    const removed = db
      .update(automationToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(automationToken.id, input.id), eq(automationToken.userId, ctx.user.id)))
      .returning({ id: automationToken.id })
      .get();
    if (!removed) throw new TRPCError({ code: 'NOT_FOUND' });
    return { success: true };
  }),
});
