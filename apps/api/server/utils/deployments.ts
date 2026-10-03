import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, isNotNull, isNull, lte, lt, max, or, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import {
  deployment,
  deploymentArtifact,
  deploymentBranchAlias,
  deploymentHistory,
  deploymentInstanceDefaults,
  deploymentLog,
  deploymentRegistryCredential,
  deploymentSecret,
  deploymentTag,
  member,
  organization,
  user,
  projectDeploymentSettings,
  projectDeploymentRuntime,
} from '../../../../drizzle/schema';
import env from './env';
import { db } from './db';
import { withArtifactStorageLock } from './deployment-storage-lock';
import { deploymentStorageRoot } from './deployment-storage';
import {
  deploymentSettingsSchema,
  projectRuntimeUpdateSchema,
  deploymentProxySchema,
  instanceDeploymentDefaultsSchema,
  isValidPreviewHostname,
  type DeploymentActor,
  type DeploymentKind,
  type DeploymentLogPage,
  type DeploymentSnapshot,
  type DeploymentStatus,
  type PublicDeployment,
  type PublishDeploymentInput,
} from '../../shared/deployments';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);
const shortDeploymentId = customAlphabet('acdefghjkmnpqrtuvwxy34679', 6);

function newDeploymentId(projectId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = shortDeploymentId();
    if (
      !db
        .select({ id: deployment.id })
        .from(deployment)
        .where(eq(deployment.id, candidate))
        .get() &&
      !db
        .select({ id: deploymentHistory.id })
        .from(deploymentHistory)
        .where(eq(deploymentHistory.deploymentId, candidate))
        .get() &&
      !db
        .select({ id: deploymentTag.id })
        .from(deploymentTag)
        .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, candidate)))
        .get()
    )
      return candidate;
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Could not allocate a deployment ID. Try again.',
  });
}
type DeploymentTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DeploymentQueryHandle = typeof db | DeploymentTx;
type DeploymentRemovalAction = 'delete' | 'clean';
const defaultSettings = deploymentSettingsSchema.parse({});
const defaultInstance = instanceDeploymentDefaultsSchema.parse({});
let previewRoutesRefresh: (() => Promise<void>) | undefined;
export function registerPreviewRoutesRefresh(callback: () => Promise<void>) {
  previewRoutesRefresh = callback;
}
async function refreshPreviewRoutes() {
  await previewRoutesRefresh?.();
}
let routeMutationTail = Promise.resolve();
async function serializeRouteMutation<T>(task: () => Promise<T>): Promise<T> {
  const prior = routeMutationTail;
  let release!: () => void;
  routeMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await task();
  } finally {
    release();
  }
}
async function refreshOrRollback(rollback: () => void) {
  try {
    await refreshPreviewRoutes();
  } catch (error) {
    rollback();
    try {
      await refreshPreviewRoutes();
    } catch (restoreError) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'The change was rolled back, but preview routes could not be confirmed. Runtime reconciliation will retry the restored routes.',
        cause: restoreError,
      });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The change was rolled back because preview routes could not be updated.',
      cause: error,
    });
  }
}
let deploymentRemovalHandler: ((deploymentId: string) => Promise<void>) | undefined;
export function registerDeploymentRemovalHandler(
  callback: (deploymentId: string) => Promise<void>,
) {
  deploymentRemovalHandler = callback;
}

const secretKey = () => createHash('sha256').update(env.BETTER_AUTH_SECRET).digest();
function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
function decrypt<T>(value: string): T {
  const [iv, tag, ciphertext] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv!, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag!, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext!, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}

export function assertProjectAccess(
  projectId: string,
  actor: { id: string; role?: string | null },
  manage = false,
  adminOnly = false,
) {
  const project = db.select().from(organization).where(eq(organization.id, projectId)).get();
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
  if (actor.role === 'admin') return project;
  const membership = db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, projectId), eq(member.userId, actor.id)))
    .get();
  if (
    !membership ||
    (adminOnly && membership.role !== 'admin') ||
    (manage && membership.role === 'viewer')
  ) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return project;
}
export function assertCanPublishProject(userId: string, projectId: string) {
  const actor = db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  if (!actor) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return assertProjectAccess(projectId, actor, true);
}

function projectRuntimeValues(projectId: string) {
  const saved = db
    .select()
    .from(projectDeploymentRuntime)
    .where(eq(projectDeploymentRuntime.projectId, projectId))
    .get();
  return {
    env: saved?.env ?? {},
    secrets: saved?.secretsCiphertext
      ? decrypt<Record<string, string>>(saved.secretsCiphertext)
      : {},
  };
}
export function getProjectRuntime(projectId: string) {
  const runtime = projectRuntimeValues(projectId);
  return { env: runtime.env, secretNames: Object.keys(runtime.secrets) };
}
export function updateProjectRuntime(projectId: string, input: unknown) {
  const valid = projectRuntimeUpdateSchema.parse(input);
  db.transaction((tx) => {
    const previous = projectRuntimeValues(projectId);
    const secrets: Record<string, string> = Object.assign(Object.create(null), previous.secrets);
    for (const name of valid.removeSecretNames) delete secrets[name];
    Object.assign(secrets, valid.secrets);
    const overlap = Object.keys(valid.env).find((name) =>
      Object.prototype.hasOwnProperty.call(secrets, name),
    );
    if (overlap)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `${overlap} is already used by a runtime secret.`,
      });
    const values = {
      env: valid.env,
      secretsCiphertext: Object.keys(secrets).length ? encrypt(secrets) : null,
      updatedAt: new Date(),
    };
    tx.insert(projectDeploymentRuntime)
      .values({ projectId, ...values })
      .onConflictDoUpdate({ target: projectDeploymentRuntime.projectId, set: values })
      .run();
  });
  return getProjectRuntime(projectId);
}

export function getProjectDeploymentSettings(projectId: string) {
  const saved = db
    .select()
    .from(projectDeploymentSettings)
    .where(eq(projectDeploymentSettings.projectId, projectId))
    .get();
  return deploymentSettingsSchema.parse(
    saved
      ? {
          spaFallback: saved.spaFallback,
          repository: saved.repository ?? '',
          retentionDays: saved.retentionDays,
          originCpus: saved.originCpus,
          originMemoryBytes: saved.originMemoryBytes,
          health: saved.health,
          proxy: saved.proxy,
        }
      : defaultSettings,
  );
}
export function updateProjectDeploymentSettings(projectId: string, settings: unknown) {
  const valid = deploymentSettingsSchema.parse(settings);
  // Parse through the strict shared proxy schema and reject ambiguous duplicate matchers.
  const proxy = deploymentProxySchema.parse(valid.proxy);
  const routePaths = proxy.routes.map((r) => r.path.replace(/\/+$/g, '') || '/');
  const matchers = proxy.cacheRules.map(
    (r) =>
      `${r.matcher}:${r.matcher === 'path' ? r.value.replace(/\/+$/g, '') || '/' : r.value.replace(/^\./, '').toLowerCase()}`,
  );
  if (
    new Set(routePaths).size !== routePaths.length ||
    new Set(matchers).size !== matchers.length
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Proxy routes and cache rules cannot contain duplicate matchers.',
    });
  }
  const now = new Date();
  const previousRetentionDays = getProjectDeploymentSettings(projectId).retentionDays;
  db.transaction((tx) => {
    // Preserve the policy of snapshots created before retention was captured.
    for (const row of tx
      .select()
      .from(deployment)
      .where(eq(deployment.projectId, projectId))
      .all()) {
      if (row.snapshot.retentionDays === undefined)
        tx.update(deployment)
          .set({ snapshot: { ...row.snapshot, retentionDays: previousRetentionDays } })
          .where(eq(deployment.id, row.id))
          .run();
    }
    tx.insert(projectDeploymentSettings)
      .values({ projectId, ...valid, repository: valid.repository || null })
      .onConflictDoUpdate({
        target: projectDeploymentSettings.projectId,
        set: { ...valid, repository: valid.repository || null, updatedAt: now },
      })
      .run();
  });
  return valid;
}
export function getInstanceDeploymentDefaults() {
  const saved = db.select().from(deploymentInstanceDefaults).get();
  if (!saved) return defaultInstance;
  return instanceDeploymentDefaultsSchema.parse(saved);
}
export function updateInstanceDeploymentDefaults(input: unknown) {
  const valid = instanceDeploymentDefaultsSchema.parse(input);
  const existing = db.select().from(deploymentInstanceDefaults).get();
  if (existing)
    db.update(deploymentInstanceDefaults)
      .set({ ...valid, updatedAt: new Date() })
      .where(eq(deploymentInstanceDefaults.id, existing.id))
      .run();
  else db.insert(deploymentInstanceDefaults).values(valid).run();
  return valid;
}

function isProtected(tx: DeploymentQueryHandle, deploymentId: string) {
  return Boolean(
    tx
      .select({ lifetime: deployment.lifetime })
      .from(deployment)
      .where(eq(deployment.id, deploymentId))
      .get()?.lifetime === 'long' ||
    tx
      .select({ id: deploymentBranchAlias.id })
      .from(deploymentBranchAlias)
      .where(eq(deploymentBranchAlias.deploymentId, deploymentId))
      .get() ||
    tx
      .select({ id: deploymentTag.id })
      .from(deploymentTag)
      .where(eq(deploymentTag.deploymentId, deploymentId))
      .get(),
  );
}
function event(
  tx: DeploymentQueryHandle,
  projectId: string,
  deploymentId: string,
  name: string,
  details: Record<string, unknown> = {},
  at = new Date(),
  actor?: DeploymentActor,
) {
  tx.insert(deploymentHistory)
    .values({
      id: id(),
      projectId,
      deploymentId,
      event: name,
      details,
      createdAt: at,
      actorType: actor ? 'user' : 'system',
      actor: actor ? { id: actor.id, name: actor.name } : null,
    })
    .run();
}
export function setDeploymentPinned(
  projectId: string,
  deploymentId: string,
  pinned: boolean,
  actor?: DeploymentActor,
) {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(deployment)
      .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
      .get();
    if (!row || row.deletedAt)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Deployment removal is already in progress.',
      });
    const previousProtected = isProtected(tx, deploymentId);
    tx.update(deployment)
      .set({ lifetime: pinned ? 'long' : 'short' })
      .where(eq(deployment.id, deploymentId))
      .run();
    if (row.readyAt || row.status === 'failed' || row.retentionStartedAt)
      updateRetention(tx, deploymentId, previousProtected);
    event(tx, projectId, deploymentId, pinned ? 'pinned' : 'unpinned', {}, new Date(), actor);
    return getProjectDeployment(projectId, deploymentId);
  });
}

function updateRetention(
  tx: DeploymentQueryHandle,
  deploymentId: string,
  previousProtected: boolean,
  at = new Date(),
) {
  const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (!row) return;
  const protectedNow = isProtected(tx, deploymentId);
  if (protectedNow) {
    tx.update(deployment)
      .set({ retentionStartedAt: null, retentionDeadlineAt: null })
      .where(eq(deployment.id, deploymentId))
      .run();
  } else if (previousProtected || !row.retentionStartedAt) {
    const days =
      row.snapshot.retentionDays ?? getProjectDeploymentSettings(row.projectId).retentionDays;
    tx.update(deployment)
      .set({
        retentionStartedAt: at,
        retentionDeadlineAt: new Date(at.getTime() + days * 86400000),
      })
      .where(eq(deployment.id, deploymentId))
      .run();
  }
}
function finishDeploymentRemoval(deploymentId: string, action: DeploymentRemovalAction, at: Date) {
  return db.transaction((tx) => {
    const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || !row.cleanupStartedAt || (action === 'clean' && isProtected(tx, deploymentId)))
      return false;
    tx.delete(deploymentSecret).where(eq(deploymentSecret.deploymentId, deploymentId)).run();
    tx.delete(deploymentLog).where(eq(deploymentLog.deploymentId, deploymentId)).run();
    tx.delete(deploymentTag).where(eq(deploymentTag.deploymentId, deploymentId)).run();
    tx.update(deploymentBranchAlias)
      .set({ deploymentId: null })
      .where(eq(deploymentBranchAlias.deploymentId, deploymentId))
      .run();
    tx.update(deployment)
      .set({
        status: action === 'delete' ? 'deleted' : 'cleaned',
        desiredState: 'stopped',
        artifactId: null,
        retentionDeadlineAt: null,
        cleanupStartedAt: null,
        cleanupAction: null,
        cleanupActor: null,
        deletedAt: at,
      })
      .where(eq(deployment.id, deploymentId))
      .run();
    event(
      tx,
      row.projectId,
      deploymentId,
      action === 'delete' ? 'deleted' : 'cleaned',
      {},
      at,
      action === 'delete' ? (row.cleanupActor ?? undefined) : undefined,
    );
    return true;
  });
}
function canonicalJson(value: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, canonical(value)]),
          )
        : value;
  return JSON.stringify(canonical(value));
}
function runtimeFingerprint(runtime: ReturnType<typeof projectRuntimeValues>) {
  return createHmac('sha256', secretKey()).update(canonicalJson(runtime)).digest('hex');
}
function currentConfiguration(projectId: string) {
  return {
    settings: getProjectDeploymentSettings(projectId),
    defaults: getInstanceDeploymentDefaults(),
    runtime: projectRuntimeValues(projectId),
    slug:
      db
        .select({ slug: organization.previewSlug })
        .from(organization)
        .where(eq(organization.id, projectId))
        .get()?.slug ?? '',
  };
}
function configurationChanges(
  row: typeof deployment.$inferSelect,
  current: ReturnType<typeof currentConfiguration>,
): string[] {
  const snapshot = row.snapshot;
  const changed: string[] = [];
  const compare = (name: string, saved: unknown, latest: unknown) => {
    if (canonicalJson(saved) !== canonicalJson(latest)) changed.push(name);
  };
  if (snapshot.retentionDays !== undefined)
    compare('Deployment retention', snapshot.retentionDays, current.settings.retentionDays);
  compare('Repository', snapshot.source.repository ?? '', current.settings.repository);
  if (row.kind === 'static')
    compare('Client-side routing', snapshot.spaFallback, current.settings.spaFallback);
  compare('Health checks', snapshot.health, current.settings.health);
  compare('Proxy routes, cache and compression', snapshot.proxy, current.settings.proxy);
  compare(
    'Origin resources',
    { cpus: Number(snapshot.limits.origin.cpus), memoryBytes: snapshot.limits.origin.memoryBytes },
    { cpus: Number(current.settings.originCpus), memoryBytes: current.settings.originMemoryBytes },
  );
  compare(
    'Proxy resources',
    { cpus: Number(snapshot.limits.proxy.cpus), memoryBytes: snapshot.limits.proxy.memoryBytes },
    { cpus: Number(current.defaults.proxyCpus), memoryBytes: current.defaults.proxyMemoryBytes },
  );
  compare('Log retention', snapshot.logs, {
    files: current.defaults.logFiles,
    fileSizeBytes: current.defaults.logFileSizeBytes,
  });
  compare('Environment variables', snapshot.env, current.runtime.env);
  if (snapshot.runtimeFingerprint) {
    if (
      snapshot.runtimeFingerprint !== runtimeFingerprint({ ...current.runtime, env: snapshot.env })
    )
      changed.push('Runtime secrets');
  } else {
    const captured = db
      .select()
      .from(deploymentSecret)
      .where(eq(deploymentSecret.deploymentId, row.id))
      .get();
    if (captured) {
      const values = decrypt<{ secrets?: Record<string, string> }>(captured.ciphertext);
      compare('Runtime secrets', values.secrets ?? {}, current.runtime.secrets);
    } else
      compare(
        'Runtime secrets',
        [...(snapshot.secretNames ?? [])].sort(),
        Object.keys(current.runtime.secrets).sort(),
      );
  }
  return changed;
}

function publicDeployment(
  row: typeof deployment.$inferSelect,
  current = currentConfiguration(row.projectId),
): PublicDeployment {
  const changes = configurationChanges(row, current);
  const snapshot = row.snapshot as DeploymentSnapshot;
  const source = (row.source ?? {}) as PublishDeploymentInput['source'];
  const snapshotSecrets = (snapshot.secretNames ?? []) as string[];
  const branch = db
    .select()
    .from(deploymentBranchAlias)
    .where(eq(deploymentBranchAlias.deploymentId, row.id))
    .get();
  const tags = db
    .select({ name: deploymentTag.name })
    .from(deploymentTag)
    .where(eq(deploymentTag.deploymentId, row.id))
    .all()
    .map((tag) => tag.name);
  return {
    id: row.id,
    previewUrl: `${process.env['PREVIEW_TLS'] === 'false' ? 'http' : 'https'}://${row.id}.${current.slug}.${process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost'}`,
    configurationOutdated: changes.length > 0,
    configurationChanges: changes,
    projectId: row.projectId,
    kind: row.kind as DeploymentKind,
    status: row.status as DeploymentStatus,
    removalPending: row.cleanupStartedAt !== null,
    desiredState: row.desiredState as 'running' | 'stopped',
    pinned: row.lifetime === 'long',
    artifactId: row.artifactId,
    imageDigest: row.imageDigest,
    source,
    submittedAt: row.submittedAt,
    readyAt: row.readyAt,
    retentionStartedAt: row.retentionStartedAt,
    retentionDeadlineAt: row.retentionDeadlineAt,
    failureReason: row.failureReason,
    config: {
      retentionDays: snapshot.retentionDays,
      image: snapshot.image ?? undefined,
      port: snapshot.port,
      env: snapshot.env,
      spaFallback: snapshot.spaFallback,
      health: snapshot.health,
      proxy: snapshot.proxy,
      limits: snapshot.limits,
      logs: snapshot.logs,
      secretNames: snapshotSecrets,
      hasSecrets: snapshotSecrets.length > 0,
    },
    branchAlias: branch?.alias ?? null,
    tags,
  };
}
export function listProjectDeployments(projectId: string) {
  const current = currentConfiguration(projectId);
  return db
    .select()
    .from(deployment)
    .where(eq(deployment.projectId, projectId))
    .orderBy(desc(deployment.submissionOrder))
    .all()
    .map((row) => publicDeployment(row, current));
}
export function getProjectDeployment(projectId: string, deploymentId: string) {
  const row = db
    .select()
    .from(deployment)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
  return publicDeployment(row);
}
export function listDeploymentHistory(
  projectId: string,
  limit = 100,
  cursor?: number,
  deploymentId?: string,
) {
  return db
    .select()
    .from(deploymentHistory)
    .where(
      and(
        eq(deploymentHistory.projectId, projectId),
        deploymentId ? eq(deploymentHistory.deploymentId, deploymentId) : undefined,
        cursor ? lt(deploymentHistory.createdAt, new Date(cursor)) : undefined,
      ),
    )
    .orderBy(desc(deploymentHistory.createdAt), desc(deploymentHistory.id))
    .limit(Math.min(limit, 200))
    .all();
}

export function registerUploadedArtifact(input: {
  projectId: string;
  kind: 'static';
  storageKey: string;
  size: number;
  sha256: string;
}) {
  if (
    !/^[a-f0-9]{64}$/.test(input.storageKey) ||
    input.storageKey !== input.sha256 ||
    !Number.isSafeInteger(input.size) ||
    input.size < 1
  )
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Artifact metadata is invalid.' });
  const artifactId = id();
  db.insert(deploymentArtifact)
    .values({ id: artifactId, ...input })
    .run();
  return { artifactId, size: input.size, sha256: input.sha256 };
}
export function getArtifact(artifactId: string) {
  const artifact = db
    .select()
    .from(deploymentArtifact)
    .where(eq(deploymentArtifact.id, artifactId))
    .get();
  if (!artifact) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found.' });
  return artifact;
}
export function listReferencedArtifactStorageKeys() {
  const artifactIds = new Set(
    db
      .select({ artifactId: deployment.artifactId })
      .from(deployment)
      .where(isNotNull(deployment.artifactId))
      .all()
      .map((row) => row.artifactId!),
  );
  return db
    .select({ id: deploymentArtifact.id, storageKey: deploymentArtifact.storageKey })
    .from(deploymentArtifact)
    .all()
    .filter((artifact) => artifactIds.has(artifact.id))
    .map((artifact) => artifact.storageKey);
}
export function getArtifactCleanupState(now = new Date()) {
  const artifacts = db.select().from(deploymentArtifact).all();
  const referencedIds = new Set(
    db
      .select({ artifactId: deployment.artifactId })
      .from(deployment)
      .where(isNotNull(deployment.artifactId))
      .all()
      .map((row) => row.artifactId!),
  );
  const groups = new Map<string, { referenced: boolean; pending: boolean; published: boolean }>();
  for (const artifact of artifacts) {
    const state = groups.get(artifact.storageKey) ?? {
      referenced: false,
      pending: false,
      published: false,
    };
    state.referenced ||= referencedIds.has(artifact.id);
    state.published ||= artifact.publishedAt !== null;
    state.pending ||=
      artifact.publishedAt === null &&
      artifact.createdAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000;
    groups.set(artifact.storageKey, state);
  }
  const referenced: string[] = [],
    pending: string[] = [],
    released: string[] = [];
  for (const [key, state] of groups) {
    if (state.referenced) referenced.push(key);
    else if (state.pending) pending.push(key);
    else if (state.published) released.push(key);
  }
  return { referenced, pending, released };
}
export function forgetArtifactStorageKey(storageKey: string, now = new Date()) {
  const rows = db
    .select()
    .from(deploymentArtifact)
    .where(eq(deploymentArtifact.storageKey, storageKey))
    .all();
  if (
    rows.some(
      (row) =>
        db
          .select({ id: deployment.id })
          .from(deployment)
          .where(eq(deployment.artifactId, row.id))
          .get() ||
        (row.publishedAt === null && row.createdAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000),
    )
  )
    return false;
  db.delete(deploymentArtifact).where(eq(deploymentArtifact.storageKey, storageKey)).run();
  return true;
}

export async function publishDeployment(input: PublishDeploymentInput, actor?: DeploymentActor) {
  return withArtifactStorageLock(deploymentStorageRoot(), () =>
    publishDeploymentLocked(input, actor),
  );
}

function publishDeploymentLocked(input: PublishDeploymentInput, actor?: DeploymentActor) {
  const runtime = projectRuntimeValues(input.projectId);
  const lifetime = input.pinned ? 'long' : 'short';
  const settings = getProjectDeploymentSettings(input.projectId);
  const defaults = getInstanceDeploymentDefaults();
  let artifactId = input.artifactId;
  let image = input.image;
  let registryCredentialId = input.registryCredentialId;
  let registryAuth: { serverAddress: string; username: string; password: string } | undefined;
  if (input.reuseDeploymentId) {
    const original = db
      .select()
      .from(deployment)
      .where(
        and(
          eq(deployment.id, input.reuseDeploymentId),
          eq(deployment.projectId, input.projectId),
          isNull(deployment.deletedAt),
        ),
      )
      .get();
    if (!original || original.kind !== input.kind)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Choose a retained deployment of the same kind to reuse.',
      });
    const originalSnapshot = original.snapshot as DeploymentSnapshot;
    if (input.kind === 'static') {
      if (!original.artifactId)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The original artifact is no longer retained.',
        });
      artifactId = original.artifactId;
    } else {
      image = original.imageDigest ?? originalSnapshot.image ?? undefined;
      if (typeof image !== 'string' || !/@sha256:[a-f0-9]{64}$/.test(image))
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The original image digest is not ready to reuse.',
        });
    }
    registryCredentialId = originalSnapshot.registryCredentialId ?? undefined;
    const originalSecrets = db
      .select()
      .from(deploymentSecret)
      .where(eq(deploymentSecret.deploymentId, original.id))
      .get();
    if (originalSecrets) {
      const data = decrypt<
        | { secrets?: Record<string, string>; registryAuth?: typeof registryAuth }
        | Record<string, string>
      >(originalSecrets.ciphertext);
      if ('secrets' in data)
        registryAuth = (
          data as { registryAuth?: { serverAddress: string; username: string; password: string } }
        ).registryAuth;
    }
  }
  if (input.kind === 'static' && !artifactId)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an uploaded static artifact.' });
  if (input.kind === 'container' && !image)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a container image.' });
  if (input.kind === 'static' && artifactId) {
    const artifact = getArtifact(artifactId);
    if (artifact.projectId !== input.projectId || artifact.kind !== 'static')
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The artifact is not available to this project.',
      });
  }
  if (input.registryCredentialId) {
    const credential = db
      .select()
      .from(deploymentRegistryCredential)
      .where(
        and(
          eq(deploymentRegistryCredential.id, input.registryCredentialId),
          eq(deploymentRegistryCredential.projectId, input.projectId),
        ),
      )
      .get();
    if (!credential)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Registry credential not found.' });
    registryAuth = {
      serverAddress: credential.registry,
      username: credential.username,
      password: decrypt<string>(credential.ciphertext),
    };
  }
  const now = new Date();
  const order =
    (db
      .select({ value: max(deployment.submissionOrder) })
      .from(deployment)
      .where(eq(deployment.projectId, input.projectId))
      .get()?.value ?? 0) + 1;
  const deploymentId = newDeploymentId(input.projectId);
  const baseDomain = process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost';
  const project = db.select().from(organization).where(eq(organization.id, input.projectId)).get()!;
  if (!isValidPreviewHostname(project.previewSlug, deploymentId, baseDomain))
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Preview domain or generated hostname is invalid.',
    });
  const assignedBranchAlias = input.source.branch
    ? branchAlias(input.source.branch, input.projectId)
    : undefined;
  if (
    assignedBranchAlias &&
    !isValidPreviewHostname(project.previewSlug, assignedBranchAlias, baseDomain)
  )
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The branch alias hostname exceeds DNS limits.',
    });
  const snapshot: DeploymentSnapshot = {
    kind: input.kind,
    artifactId: artifactId ?? null,
    image: image ?? null,
    registryCredentialId: registryCredentialId ?? null,
    lifetime,
    source: { ...input.source, repository: settings.repository || undefined },
    secretNames: Object.keys(runtime.secrets),
    port: input.port,
    env: runtime.env,
    runtimeFingerprint: runtimeFingerprint(runtime),
    retentionDays: settings.retentionDays,
    spaFallback: settings.spaFallback,
    health: settings.health,
    proxy: settings.proxy,
    limits: {
      origin: { cpus: settings.originCpus, memoryBytes: settings.originMemoryBytes },
      proxy: { cpus: defaults.proxyCpus, memoryBytes: defaults.proxyMemoryBytes },
    },
    logs: { files: defaults.logFiles, fileSizeBytes: defaults.logFileSizeBytes },
  };
  db.transaction((tx) => {
    const initialDigest = input.kind === 'container' && image?.includes('@sha256:') ? image : null;
    tx.insert(deployment)
      .values({
        id: deploymentId,
        projectId: input.projectId,
        artifactId: artifactId ?? null,
        kind: input.kind,
        lifetime,
        submittedAt: now,
        submissionOrder: order,
        source: snapshot.source,
        snapshot,
        imageDigest: initialDigest,
      })
      .run();
    if (artifactId)
      tx.update(deploymentArtifact)
        .set({ publishedAt: now })
        .where(eq(deploymentArtifact.id, artifactId))
        .run();
    if (Object.keys(runtime.secrets).length || registryAuth)
      tx.insert(deploymentSecret)
        .values({ deploymentId, ciphertext: encrypt({ secrets: runtime.secrets, registryAuth }) })
        .run();
    event(
      tx,
      input.projectId,
      deploymentId,
      'submitted',
      { kind: input.kind, pinned: input.pinned, source: input.source },
      now,
      actor,
    );
    if (input.source.branch) {
      tx.insert(deploymentBranchAlias)
        .values({
          id: id(),
          projectId: input.projectId,
          branch: input.source.branch,
          alias: assignedBranchAlias!,
          deploymentId: null,
          selectionOrder: 0,
        })
        .onConflictDoNothing()
        .run();
    }
  });
  return getProjectDeployment(input.projectId, deploymentId);
}

function branchAlias(branch: string, projectId: string) {
  const clean =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'branch';
  const simple = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(branch);
  const hash = createHash('sha256').update(branch).digest('hex');
  for (let length = simple ? 0 : 8; length <= 56; length = length === 0 ? 8 : length + 2) {
    // Preserve the readable form where possible; if it collides with an alias
    // already assigned to another original branch, hash this name too.
    const label = clean.slice(0, 59 - length).replace(/-+$/g, '') || 'b';
    const alias = length === 0 ? `br-${branch}` : `br-${label}-${hash.slice(0, length)}`;
    const collision = db
      .select()
      .from(deploymentBranchAlias)
      .where(
        and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.alias, alias)),
      )
      .get();
    if (!collision || collision.branch === branch) return alias;
  }
  throw new TRPCError({ code: 'CONFLICT', message: 'Could not allocate a unique branch address.' });
}

export async function markDeploymentReady(deploymentId: string, at = new Date()) {
  db.transaction((tx) => {
    const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || row.deletedAt) return;
    if (
      row.cleanupStartedAt ||
      row.desiredState !== 'running' ||
      !['queued', 'starting', 'healthy', 'unhealthy'].includes(row.status)
    )
      return;
    tx.update(deployment)
      .set({ status: 'healthy', readyAt: at, failureReason: null })
      .where(eq(deployment.id, deploymentId))
      .run();
    event(tx, row.projectId, row.id, 'healthy', {}, at);
    const branch = row.source?.branch;
    if (branch) {
      const current = tx
        .select()
        .from(deploymentBranchAlias)
        .where(
          and(
            eq(deploymentBranchAlias.projectId, row.projectId),
            eq(deploymentBranchAlias.branch, branch),
          ),
        )
        .get();
      if (!current || row.submissionOrder >= current.selectionOrder) {
        const lostProtection = current?.deploymentId
          ? isProtected(tx, current.deploymentId)
          : false;
        if (current)
          tx.update(deploymentBranchAlias)
            .set({ deploymentId: row.id, selectionOrder: row.submissionOrder, updatedAt: at })
            .where(eq(deploymentBranchAlias.id, current.id))
            .run();
        else
          tx.insert(deploymentBranchAlias)
            .values({
              id: id(),
              projectId: row.projectId,
              branch,
              alias: branchAlias(branch, row.projectId),
              deploymentId: row.id,
              selectionOrder: row.submissionOrder,
            })
            .onConflictDoUpdate({
              target: [deploymentBranchAlias.projectId, deploymentBranchAlias.branch],
              set: { deploymentId: row.id, selectionOrder: row.submissionOrder, updatedAt: at },
            })
            .run();
        if (current?.deploymentId) updateRetention(tx, current.deploymentId, lostProtection, at);
      }
    }
    updateRetention(tx, row.id, false, at);
  });
  await refreshPreviewRoutes();
}
export async function markDeploymentFailed(deploymentId: string, reason: string, at = new Date()) {
  const safeReason = reason.slice(0, 4000);
  db.transaction((tx) => {
    const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (
      !row ||
      row.deletedAt ||
      row.cleanupStartedAt ||
      row.desiredState !== 'running' ||
      !['queued', 'starting'].includes(row.status)
    )
      return;
    tx.update(deployment)
      .set({ status: 'failed', failureReason: safeReason })
      .where(eq(deployment.id, deploymentId))
      .run();
    event(tx, row.projectId, row.id, 'failed', { reason: safeReason }, at);
    updateRetention(tx, row.id, false, at);
  });
}
export function markDeploymentStarting(deploymentId: string, at = new Date()) {
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.desiredState !== 'running' ||
    !['queued', 'starting', 'healthy', 'unhealthy'].includes(row.status)
  )
    return null;
  if (row.status !== 'starting') {
    db.update(deployment).set({ status: 'starting' }).where(eq(deployment.id, deploymentId)).run();
    event(db, row.projectId, row.id, 'starting', {}, at);
  }
  return getDeploymentRuntimeConfig(deploymentId);
}
export async function setDeploymentHealth(
  deploymentId: string,
  status: 'healthy' | 'unhealthy',
  reason?: string,
  at = new Date(),
) {
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.desiredState !== 'running' ||
    !['healthy', 'unhealthy'].includes(row.status)
  )
    return;
  db.update(deployment)
    .set({ status, failureReason: reason?.slice(0, 4000) ?? null })
    .where(eq(deployment.id, deploymentId))
    .run();
  event(
    db,
    row.projectId,
    deploymentId,
    status,
    reason ? { reason: reason.slice(0, 4000) } : {},
    at,
  );
}
export async function requestDeploymentStart(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || row.deletedAt) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The deployment is being removed and cannot be restarted.',
      });
    if (!row.artifactId && row.kind === 'static')
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The deployment artifact is no longer retained.',
      });
    db.update(deployment)
      .set({ desiredState: 'running', status: 'queued', failureReason: null })
      .where(eq(deployment.id, deploymentId))
      .run();
    await refreshOrRollback(() =>
      db
        .update(deployment)
        .set({
          desiredState: row.desiredState,
          status: row.status,
          failureReason: row.failureReason,
        })
        .where(eq(deployment.id, deploymentId))
        .run(),
    );
    event(db, row.projectId, row.id, 'restart-requested', {}, new Date(), actor);
    return getProjectDeployment(row.projectId, row.id);
  });
}
export async function stopDeployment(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || row.deletedAt) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The deployment is being removed and cannot be stopped.',
      });
    db.update(deployment)
      .set({ desiredState: 'stopped', status: 'stopped' })
      .where(eq(deployment.id, deploymentId))
      .run();
    await refreshOrRollback(() =>
      db
        .update(deployment)
        .set({
          desiredState: row.desiredState,
          status: row.status,
          failureReason: row.failureReason,
        })
        .where(eq(deployment.id, deploymentId))
        .run(),
    );
    event(db, row.projectId, row.id, 'stopped', {}, new Date(), actor);
    return getProjectDeployment(row.projectId, row.id);
  });
}
export async function deleteDeployment(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || row.deletedAt) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'A deployment removal is already pending.',
      });
    db.update(deployment)
      .set({
        cleanupStartedAt: new Date(),
        cleanupAction: 'delete',
        cleanupActor: actor ? { id: actor.id, name: actor.name } : null,
      })
      .where(eq(deployment.id, deploymentId))
      .run();
    try {
      await refreshPreviewRoutes();
      await deploymentRemovalHandler?.(deploymentId);
    } catch (error) {
      db.update(deployment)
        .set({ cleanupStartedAt: null, cleanupAction: null, cleanupActor: null })
        .where(eq(deployment.id, deploymentId))
        .run();
      try {
        await refreshPreviewRoutes();
      } catch (restoreError) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            'Runtime removal failed and the deployment was preserved, but its previous preview route could not be confirmed.',
          cause: restoreError,
        });
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Runtime removal failed; secrets, artifacts, and history were preserved.',
        cause: error,
      });
    }
    if (!finishDeploymentRemoval(deploymentId, 'delete', new Date()))
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The deployment removal intent changed before deletion completed.',
      });
    await refreshPreviewRoutes();
    return { success: true };
  });
}
export function removeDeploymentHistory(projectId: string, deploymentId: string) {
  const row = db
    .select()
    .from(deployment)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment history not found.' });
  if (!['deleted', 'cleaned'].includes(row.status) || row.artifactId)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Only deleted or cleaned deployments can have their history permanently removed.',
    });
  db.transaction((tx) => {
    tx.delete(deploymentHistory)
      .where(
        and(
          eq(deploymentHistory.projectId, projectId),
          eq(deploymentHistory.deploymentId, deploymentId),
        ),
      )
      .run();
    tx.delete(deployment).where(eq(deployment.id, deploymentId)).run();
  });
  return { success: true };
}
export async function assignDeploymentTag(
  projectId: string,
  name: string,
  deploymentId: string,
  actor?: DeploymentActor,
) {
  return serializeRouteMutation(async () => {
    if (!/^(?!br-)(?!dpl-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Tags must be lowercase DNS labels and cannot start with br- or dpl-.',
      });
    if (
      db
        .select({ id: deployment.id })
        .from(deployment)
        .where(and(eq(deployment.projectId, projectId), eq(deployment.id, name)))
        .get()
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Tag names cannot match a deployment ID.',
      });
    const project = db.select().from(organization).where(eq(organization.id, projectId)).get();
    if (
      !project ||
      !isValidPreviewHostname(
        project.previewSlug,
        name,
        process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
      )
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The tag hostname exceeds DNS limits or the configured preview domain is invalid.',
      });
    const target = db
      .select()
      .from(deployment)
      .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
      .get();
    if (
      !target ||
      target.cleanupStartedAt ||
      target.status !== 'healthy' ||
      target.desiredState !== 'running'
    )
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Tags can only select a healthy deployment that is not being removed.',
      });
    const prior = db
      .select()
      .from(deploymentTag)
      .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
      .get();
    const affectedIds = [
      ...new Set(
        [prior?.deploymentId, deploymentId].filter((value): value is string => Boolean(value)),
      ),
    ];
    const retention = affectedIds
      .map((value) =>
        db
          .select({
            id: deployment.id,
            retentionStartedAt: deployment.retentionStartedAt,
            retentionDeadlineAt: deployment.retentionDeadlineAt,
          })
          .from(deployment)
          .where(eq(deployment.id, value))
          .get(),
      )
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    db.transaction((tx) => {
      if (prior) tx.delete(deploymentTag).where(eq(deploymentTag.id, prior.id)).run();
      tx.insert(deploymentTag).values({ id: id(), projectId, name, deploymentId }).run();
      if (prior) updateRetention(tx, prior.deploymentId, true);
      updateRetention(tx, deploymentId, false);
    });
    await refreshOrRollback(() =>
      db.transaction((tx) => {
        tx.delete(deploymentTag)
          .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
          .run();
        if (prior) tx.insert(deploymentTag).values(prior).run();
        for (const value of retention)
          tx.update(deployment)
            .set({
              retentionStartedAt: value.retentionStartedAt,
              retentionDeadlineAt: value.retentionDeadlineAt,
            })
            .where(eq(deployment.id, value.id))
            .run();
      }),
    );
    event(db, projectId, deploymentId, 'tag-assigned', { name }, new Date(), actor);
    return { success: true };
  });
}
export async function removeDeploymentTag(
  projectId: string,
  name: string,
  actor?: DeploymentActor,
) {
  return serializeRouteMutation(async () => {
    const tag = db
      .select()
      .from(deploymentTag)
      .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
      .get();
    if (!tag) return { success: true };
    const priorDeployment = db
      .select({
        retentionStartedAt: deployment.retentionStartedAt,
        retentionDeadlineAt: deployment.retentionDeadlineAt,
      })
      .from(deployment)
      .where(eq(deployment.id, tag.deploymentId))
      .get();
    db.transaction((tx) => {
      tx.delete(deploymentTag).where(eq(deploymentTag.id, tag.id)).run();
      updateRetention(tx, tag.deploymentId, true);
    });
    await refreshOrRollback(() =>
      db.transaction((tx) => {
        tx.insert(deploymentTag).values(tag).run();
        if (priorDeployment)
          tx.update(deployment)
            .set(priorDeployment)
            .where(eq(deployment.id, tag.deploymentId))
            .run();
      }),
    );
    event(db, projectId, tag.deploymentId, 'tag-removed', { name }, new Date(), actor);
    return { success: true };
  });
}

export async function cleanupDueDeployments(now = new Date()) {
  const due = db
    .select()
    .from(deployment)
    .where(
      and(
        isNull(deployment.deletedAt),
        isNotNull(deployment.retentionDeadlineAt),
        lte(deployment.retentionDeadlineAt, now),
      ),
    )
    .all();
  let cleaned = 0;
  for (const candidate of due) {
    const didClean = await serializeRouteMutation(async () => {
      const row = db
        .select()
        .from(deployment)
        .where(
          and(
            eq(deployment.id, candidate.id),
            isNull(deployment.deletedAt),
            isNotNull(deployment.retentionDeadlineAt),
            lte(deployment.retentionDeadlineAt, now),
          ),
        )
        .get();
      if (!row || row.cleanupStartedAt || isProtected(db, row.id)) return false;

      // Persist the intent before awaiting runtime removal. It keeps readiness
      // callbacks and new tag assignments from protecting a resource halfway
      // through physical deletion.
      db.update(deployment)
        .set({ cleanupStartedAt: now, cleanupAction: 'clean' })
        .where(eq(deployment.id, row.id))
        .run();
      try {
        await refreshPreviewRoutes();
      } catch (error) {
        db.update(deployment)
          .set({ cleanupStartedAt: null, cleanupAction: null, cleanupActor: null })
          .where(eq(deployment.id, row.id))
          .run();
        try {
          await refreshPreviewRoutes();
        } catch {
          /* the original route-refresh error is the actionable failure */
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Cleanup could not retire the preview route; the deployment was preserved.',
          cause: error,
        });
      }

      try {
        await deploymentRemovalHandler?.(row.id);
      } catch (error) {
        db.update(deployment)
          .set({ cleanupStartedAt: null, cleanupAction: null, cleanupActor: null })
          .where(eq(deployment.id, row.id))
          .run();
        try {
          await refreshPreviewRoutes();
        } catch (restoreError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message:
              'Runtime removal failed and the deployment was preserved, but its previous preview route could not be confirmed.',
            cause: restoreError,
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Runtime removal failed; secrets, artifacts, and history were preserved.',
          cause: error,
        });
      }

      return finishDeploymentRemoval(row.id, 'clean', now);
    });
    if (didClean) cleaned++;
  }
  return cleaned;
}

/** Retries durable removals left pending if the API stopped before finalizing their records. */
export async function resumePendingDeploymentRemovals() {
  const pending = db
    .select({ id: deployment.id })
    .from(deployment)
    .where(isNotNull(deployment.cleanupStartedAt))
    .orderBy(asc(deployment.submittedAt), asc(deployment.id))
    .all();
  let completed = 0;
  let firstError: unknown;
  for (const item of pending) {
    try {
      const didComplete = await serializeRouteMutation(async () => {
        const row = db.select().from(deployment).where(eq(deployment.id, item.id)).get();
        if (!row?.cleanupStartedAt) return false;
        const action: DeploymentRemovalAction =
          row.cleanupAction === 'delete' || row.cleanupAction === 'clean'
            ? row.cleanupAction
            : row.retentionDeadlineAt && row.retentionDeadlineAt <= row.cleanupStartedAt
              ? 'clean'
              : 'delete';
        if (action === 'clean' && isProtected(db, row.id)) {
          db.update(deployment)
            .set({ cleanupStartedAt: null, cleanupAction: null, cleanupActor: null })
            .where(eq(deployment.id, row.id))
            .run();
          await refreshPreviewRoutes();
          return false;
        }
        if (!deploymentRemovalHandler)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Deployment runtime removal is not available yet.',
          });
        try {
          await refreshPreviewRoutes();
          await deploymentRemovalHandler(row.id);
        } catch (error) {
          db.update(deployment)
            .set({ cleanupStartedAt: null, cleanupAction: null, cleanupActor: null })
            .where(eq(deployment.id, row.id))
            .run();
          try {
            await refreshPreviewRoutes();
          } catch (restoreError) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message:
                'Pending runtime removal failed and the deployment was preserved, but its previous route could not be confirmed.',
              cause: restoreError,
            });
          }
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message:
              'Pending runtime removal failed; the deployment record and secrets were restored for service.',
            cause: error,
          });
        }
        return finishDeploymentRemoval(row.id, action, new Date());
      });
      if (didComplete) completed++;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
  return completed;
}

export function getDeploymentRuntimeConfig(deploymentId: string) {
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (!row || row.deletedAt || row.cleanupStartedAt) return null;
  const snapshot = row.snapshot as DeploymentSnapshot;
  const encrypted = db
    .select()
    .from(deploymentSecret)
    .where(eq(deploymentSecret.deploymentId, deploymentId))
    .get();
  const data = encrypted
    ? decrypt<
        | {
            secrets?: Record<string, string>;
            registryAuth?: { serverAddress: string; username: string; password: string };
          }
        | Record<string, string>
      >(encrypted.ciphertext)
    : {};
  const hasSecretEnvelope = Object.prototype.hasOwnProperty.call(data, 'secrets');
  const envelope = data as {
    secrets?: Record<string, string>;
    registryAuth?: { serverAddress: string; username: string; password: string };
  };
  const secrets = hasSecretEnvelope ? (envelope.secrets ?? {}) : (data as Record<string, string>);
  const credential = snapshot.registryCredentialId
    ? getRegistrySecret(snapshot.registryCredentialId)
    : null;
  const registryAuth =
    (hasSecretEnvelope ? envelope.registryAuth : undefined) ??
    (credential
      ? {
          serverAddress: credential.registry,
          username: credential.username,
          password: credential.secret,
        }
      : undefined);
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    artifactId: row.artifactId,
    imageDigest: row.imageDigest ?? snapshot.image,
    port: snapshot.port,
    env: snapshot.env,
    secrets,
    registryAuth,
    health: snapshot.health,
    spaFallback: snapshot.spaFallback,
    proxy: snapshot.proxy,
    limits: snapshot.limits,
    logs: snapshot.logs,
    desiredState: row.desiredState,
    status: row.status,
    submittedAt: row.submittedAt,
  };
}
export function listDeploymentRuntimeConfigs() {
  return db
    .select({ id: deployment.id })
    .from(deployment)
    .where(isNull(deployment.deletedAt))
    .orderBy(asc(deployment.submissionOrder))
    .all()
    .map((row) => getDeploymentRuntimeConfig(row.id))
    .filter(Boolean);
}
export function getPreviewRouteTargets() {
  const projects = db
    .select({ id: organization.id, projectSlug: organization.previewSlug })
    .from(organization)
    .all();
  const projectSlugs = new Map(projects.map((project) => [project.id, project.projectSlug]));
  const available = new Set(
    db
      .select({ id: deployment.id })
      .from(deployment)
      .where(
        and(
          isNull(deployment.deletedAt),
          isNull(deployment.cleanupStartedAt),
          eq(deployment.desiredState, 'running'),
          or(eq(deployment.status, 'healthy'), eq(deployment.status, 'unhealthy')),
        ),
      )
      .all()
      .map((row) => row.id),
  );
  return {
    baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    deployments: db
      .select({ deploymentId: deployment.id, projectId: deployment.projectId })
      .from(deployment)
      .where(
        and(
          isNull(deployment.deletedAt),
          isNull(deployment.cleanupStartedAt),
          eq(deployment.desiredState, 'running'),
          or(eq(deployment.status, 'healthy'), eq(deployment.status, 'unhealthy')),
        ),
      )
      .all()
      .map((target) => ({
        deploymentId: target.deploymentId,
        projectSlug: projectSlugs.get(target.projectId)!,
      })),
    branches: db
      .select({
        branchAlias: deploymentBranchAlias.alias,
        projectId: deploymentBranchAlias.projectId,
        deploymentId: deploymentBranchAlias.deploymentId,
      })
      .from(deploymentBranchAlias)
      .all()
      .filter((target) => target.deploymentId && available.has(target.deploymentId))
      .map((target) => ({
        branchAlias: target.branchAlias,
        projectSlug: projectSlugs.get(target.projectId)!,
        deploymentId: target.deploymentId!,
      })),
    tags: db
      .select()
      .from(deploymentTag)
      .all()
      .filter((target) => available.has(target.deploymentId))
      .map((target) => ({
        tag: target.name,
        projectSlug: projectSlugs.get(target.projectId)!,
        deploymentId: target.deploymentId,
      })),
  };
}

export async function updateProjectPreviewSlug(projectId: string, slug: string) {
  return serializeRouteMutation(async () => {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Preview slugs must be lowercase DNS labels with letters, digits, and internal hyphens.',
      });
    const conflict = db
      .select()
      .from(organization)
      .where(and(eq(organization.previewSlug, slug), sql`${organization.id} <> ${projectId}`))
      .get();
    if (conflict)
      throw new TRPCError({ code: 'CONFLICT', message: 'That preview slug is already in use.' });
    const domain = process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost';
    if (!isValidPreviewHostname(slug, 'a'.repeat(63), domain))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'The configured preview domain leaves no room for valid deployment, branch, and tag labels.',
      });
    const tooLong = db
      .select()
      .from(deployment)
      .where(eq(deployment.projectId, projectId))
      .all()
      .some((row) => !isValidPreviewHostname(slug, row.id, domain));
    if (tooLong)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The generated preview hostname would exceed the DNS name limit.',
      });
    const before = db.select().from(organization).where(eq(organization.id, projectId)).get();
    if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
    const saved = db
      .update(organization)
      .set({ previewSlug: slug })
      .where(eq(organization.id, projectId))
      .returning()
      .get();
    await refreshOrRollback(() =>
      db
        .update(organization)
        .set({ previewSlug: before.previewSlug })
        .where(and(eq(organization.id, projectId), eq(organization.previewSlug, slug)))
        .run(),
    );
    return saved;
  });
}

export function setDeploymentImageDigest(deploymentId: string, digest: string) {
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(digest))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Image digest is invalid.' });
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  if (row.imageDigest && row.imageDigest !== digest)
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'A deployment image digest is immutable once resolved.',
    });
  db.update(deployment).set({ imageDigest: digest }).where(eq(deployment.id, deploymentId)).run();
}

export function listRegistryCredentials(projectId: string) {
  return db
    .select({
      id: deploymentRegistryCredential.id,
      name: deploymentRegistryCredential.name,
      registry: deploymentRegistryCredential.registry,
      username: deploymentRegistryCredential.username,
      createdAt: deploymentRegistryCredential.createdAt,
    })
    .from(deploymentRegistryCredential)
    .where(eq(deploymentRegistryCredential.projectId, projectId))
    .all();
}
export function saveRegistryCredential(input: {
  projectId: string;
  id?: string;
  name: string;
  registry: string;
  username: string;
  secret: string;
}) {
  const saved = input.id
    ? db
        .select()
        .from(deploymentRegistryCredential)
        .where(
          and(
            eq(deploymentRegistryCredential.id, input.id),
            eq(deploymentRegistryCredential.projectId, input.projectId),
          ),
        )
        .get()
    : undefined;
  if (saved)
    db.update(deploymentRegistryCredential)
      .set({
        name: input.name,
        registry: input.registry,
        username: input.username,
        ciphertext: input.secret ? encrypt(input.secret) : saved.ciphertext,
        updatedAt: new Date(),
      })
      .where(eq(deploymentRegistryCredential.id, saved.id))
      .run();
  else
    db.insert(deploymentRegistryCredential)
      .values({
        id: id(),
        projectId: input.projectId,
        name: input.name,
        registry: input.registry,
        username: input.username,
        ciphertext: encrypt(input.secret),
      })
      .run();
  return listRegistryCredentials(input.projectId);
}
export function deleteRegistryCredential(projectId: string, credentialId: string) {
  db.delete(deploymentRegistryCredential)
    .where(
      and(
        eq(deploymentRegistryCredential.id, credentialId),
        eq(deploymentRegistryCredential.projectId, projectId),
      ),
    )
    .run();
  return { success: true };
}
export function getRegistrySecret(credentialId: string) {
  const credential = db
    .select()
    .from(deploymentRegistryCredential)
    .where(eq(deploymentRegistryCredential.id, credentialId))
    .get();
  return credential
    ? {
        registry: credential.registry,
        username: credential.username,
        secret: decrypt<string>(credential.ciphertext),
      }
    : null;
}
export function getDeploymentLogs(
  deploymentId: string,
  source: 'proxy' | 'origin',
  limit = 100,
  cursor?: { createdAt: number; id: string },
): DeploymentLogPage {
  const page = db
    .select()
    .from(deploymentLog)
    .where(
      and(
        eq(deploymentLog.deploymentId, deploymentId),
        eq(deploymentLog.source, source),
        cursor
          ? or(
              lt(deploymentLog.createdAt, new Date(cursor.createdAt)),
              and(
                eq(deploymentLog.createdAt, new Date(cursor.createdAt)),
                lt(deploymentLog.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(deploymentLog.createdAt), desc(deploymentLog.id))
    .limit(Math.min(limit, 500) + 1)
    .all();
  const hasOlder = page.length > Math.min(limit, 500);
  const rows = page.slice(0, Math.min(limit, 500));
  const oldest = rows[rows.length - 1];
  return {
    logs: rows.reverse().map((row) => ({ ...row, source })),
    nextCursor:
      hasOlder && oldest ? { createdAt: oldest.createdAt.getTime(), id: oldest.id } : null,
  };
}
export function appendDeploymentLog(
  deploymentId: string,
  source: 'proxy' | 'origin',
  content: string,
) {
  const row = db
    .select({
      snapshot: deployment.snapshot,
      status: deployment.status,
      deletedAt: deployment.deletedAt,
      cleanupStartedAt: deployment.cleanupStartedAt,
    })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .get();
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.status === 'deleted' ||
    row.status === 'cleaned'
  )
    return;
  const limits = (row.snapshot as DeploymentSnapshot).logs ?? {
    files: 3,
    fileSizeBytes: 10 * 1024 * 1024,
  };
  const maxBytes = Math.max(1024, limits.files * limits.fileSizeBytes);
  const encoded = Buffer.from(content, 'utf8');
  let start = Math.max(0, encoded.length - maxBytes);
  while (start < encoded.length && (encoded[start]! & 0xc0) === 0x80) start++;
  const clipped = encoded.subarray(start).toString('utf8');
  db.transaction((tx) => {
    tx.insert(deploymentLog)
      .values({ id: id(), deploymentId, source, content: clipped, createdAt: new Date() })
      .run();
    const rows = tx
      .select({ id: deploymentLog.id, content: deploymentLog.content })
      .from(deploymentLog)
      .where(and(eq(deploymentLog.deploymentId, deploymentId), eq(deploymentLog.source, source)))
      .orderBy(asc(deploymentLog.createdAt), asc(deploymentLog.id))
      .all();
    let bytes = rows.reduce((total, item) => total + Buffer.byteLength(item.content), 0);
    for (const item of rows) {
      if (bytes <= maxBytes) break;
      tx.delete(deploymentLog).where(eq(deploymentLog.id, item.id)).run();
      bytes -= Buffer.byteLength(item.content);
    }
  });
}
