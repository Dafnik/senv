import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, beforeEach, vi } from 'vite-plus/test';
import { member, organization, projectDeploymentSettings, user } from '../../../drizzle/schema';
import { deploymentSettingsSchema } from '../shared/deployments';

export let db: typeof import('./utils/db').db;
export let api: typeof import('./utils/deployments');
export let auth: typeof import('./utils/auth').auth;
export let appRouter: typeof import('./trpc/routers').appRouter;
export const directory = mkdtempSync(join(tmpdir(), 'senv-deployments-'));
export const projectId = 'deployment-test-project';
export const adminId = 'deployment-test-admin';
export const developerId = 'deployment-test-developer';
export const viewerId = 'deployment-test-viewer';

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', `file:${join(directory, 'deployments.sqlite')}`);
  vi.stubEnv('BETTER_AUTH_SECRET', 'deployment-tests-secret-at-least-32-characters');
  vi.stubEnv('ROOT_DOMAIN', 'localhost');
  vi.stubEnv('API_URL', 'http://localhost:3000');
  vi.stubEnv('APP_URL', 'http://localhost:4200');
  vi.stubEnv('NODE_ENV', 'test');
  ({ db } = await import('./utils/db'));
  migrate(db, { migrationsFolder: 'drizzle/migrations' });
  api = await import('./utils/deployments');
  ({ auth } = await import('./utils/auth'));
  ({ appRouter } = await import('./trpc/routers'));
});

beforeEach(() => {
  api.registerDeploymentRemovalHandler(async () => {});
  api.registerPreviewRoutesRefresh(async () => {});
  db.delete(organization).run();
  db.delete(user).run();
  db.insert(user)
    .values([
      { id: adminId, name: 'Instance admin', email: 'deployment-admin@example.com', role: 'admin' },
      { id: developerId, name: 'Developer', email: 'deployment-developer@example.com' },
      { id: viewerId, name: 'Viewer', email: 'deployment-viewer@example.com' },
    ])
    .run();
  db.insert(organization)
    .values({
      id: projectId,
      name: 'Deployment test',
      slug: projectId,
      previewSlug: 'deployment-test',
    })
    .run();
  db.insert(member)
    .values([
      {
        id: 'developer-membership',
        organizationId: projectId,
        userId: developerId,
        role: 'developer',
      },
      { id: 'viewer-membership', organizationId: projectId, userId: viewerId, role: 'viewer' },
    ])
    .run();
  db.insert(projectDeploymentSettings)
    .values({
      projectId,
      ...deploymentSettingsSchema.parse({}),
      repository: 'https://example.com/team/site.git',
    })
    .run();
});

afterAll(() => {
  db?.$client.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

export async function publishStatic(overrides: Record<string, unknown> = {}) {
  api.updateProjectRuntime(projectId, {
    env: { PUBLIC_MODE: 'preview' },
    secrets: { API_TOKEN: 'never-return-this' },
  });
  return api.publishDeployment({
    projectId,
    kind: 'static',
    artifactId: 'static-artifact',
    pinned: false,
    source: {},
    port: 8080,

    ...overrides,
  } as Parameters<typeof api.publishDeployment>[0]);
}

export async function caller(email: string, role?: 'admin') {
  const created = await auth.api.createUser({
    body: { name: email, email, password: 'deployment-caller-password' },
  });
  if (role) db.update(user).set({ role }).where(eq(user.id, created.user.id)).run();
  const login = await auth.api.signInEmail({
    body: { email, password: 'deployment-caller-password' },
    asResponse: true,
  });
  return {
    id: created.user.id,
    api: appRouter.createCaller({
      req: new Request('http://localhost:3000/api/trpc', {
        headers: new Headers({
          cookie: login.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';')[0])
            .join(';'),
        }),
      }),
    }),
  };
}
