import { H3 } from 'nitro/h3';
import { beforeAll, expect, test } from 'vite-plus/test';
import { member, organization } from '../../../../../../drizzle/schema';
import { ArtifactStore } from '../runtime/artifacts';
import { deploymentStorageRoot } from '../storage/storage';
import { api, auth, caller, db, projectId } from './deployments.test-support';
let projectArtifact: typeof import('../services/artifact-browser').projectArtifact;
let projectArtifacts: typeof import('../services/artifact-browser').projectArtifacts;
beforeAll(async () => {
  ({ projectArtifact, projectArtifacts } = await import('../services/artifact-browser'));
});

async function uploaded(source?: { branch?: string; commit?: string }) {
  const store = new ArtifactStore({ root: deploymentStorageRoot(), maxBytes: 1000 });
  await store.initialize();
  const saved = await store.ingestFiles([
    { name: 'index.html', data: Buffer.from('<h1>Test</h1>') },
    { name: 'assets/a & été.txt', data: Buffer.from('download contents') },
  ]);
  return api.registerUploadedArtifact({ projectId, kind: 'static', ...saved, source });
}

async function viewer() {
  const user = await caller('artifact-viewer@example.com');
  db.insert(member)
    .values({ id: 'artifact-viewer', organizationId: projectId, userId: user.id, role: 'viewer' })
    .run();
  return user;
}

test('project artifact APIs allow viewers to browse and reject outsiders and other-project IDs', async () => {
  const artifact = await uploaded();
  const published = await api.publishDeployment({
    projectId,
    kind: 'static',
    artifactId: artifact.artifactId,
    source: { branch: 'main', commit: 'abc123' },
    pinned: false,
    port: 80,
  });
  const reader = await viewer();
  const outsider = await caller('artifact-outsider@example.com');
  const page = await reader.api.artifacts.list({ projectId });
  expect(page.total).toBe(1);
  expect(page.items[0]).toMatchObject({
    id: artifact.artifactId,
    source: { branch: 'main', commit: 'abc123' },
    deployments: [{ id: published.id }],
  });
  expect(JSON.stringify(page)).not.toContain('storageKey');
  expect(
    await reader.api.artifacts.directory({
      projectId,
      artifactId: artifact.artifactId,
      path: 'assets',
    }),
  ).toMatchObject({ entries: [{ path: 'assets/a & été.txt', size: 17 }] });
  expect(
    await reader.api.artifacts.file({
      projectId,
      artifactId: artifact.artifactId,
      path: 'assets/a & été.txt',
    }),
  ).toMatchObject({
    name: 'a & été.txt',
    kind: 'code',
    language: 'text',
    text: 'download contents',
  });
  await expect(
    outsider.api.artifacts.file({ projectId, artifactId: artifact.artifactId, path: 'index.html' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(outsider.api.artifacts.list({ projectId })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    outsider.api.artifacts.detail({ projectId, artifactId: artifact.artifactId }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    reader.api.artifacts.directory({ projectId, artifactId: artifact.artifactId, path: '..' }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  db.insert(organization)
    .values({ id: 'other', name: 'Other', slug: 'other', previewSlug: 'other' })
    .run();
  db.insert(member)
    .values({ id: 'other-viewer', organizationId: 'other', userId: reader.id, role: 'viewer' })
    .run();
  expect(await reader.api.artifacts.list({ projectId: 'other' })).toEqual({ items: [], total: 0 });
  await expect(
    reader.api.artifacts.detail({ projectId: 'other', artifactId: artifact.artifactId }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('artifact source stays fixed on reuse, missing source remains optional, and pending uploads are hidden', async () => {
  const captured = { branch: 'upload-branch', commit: 'upload-commit' };
  const artifact = await uploaded(captured);
  expect(projectArtifacts(projectId, 50, 0).total).toBe(0);
  expect(() => projectArtifact(projectId, artifact.artifactId)).toThrow('Artifact not found');
  const original = await api.publishDeployment({
    projectId,
    kind: 'static',
    artifactId: artifact.artifactId,
    source: { branch: 'deployment-branch' },
    pinned: false,
    port: 80,
  });
  await api.publishDeployment({
    projectId,
    kind: 'static',
    reuseDeploymentId: original.id,
    source: { branch: 'different-branch', commit: 'different-commit' },
    pinned: false,
    port: 80,
  });
  const detail = projectArtifact(projectId, artifact.artifactId);
  expect(detail.source).toEqual(captured);
  expect(detail.deployments).toHaveLength(2);
  expect(projectArtifacts(projectId, 1, 0).items).toHaveLength(1);
  expect(projectArtifacts(projectId, 1, 1).items).toHaveLength(0);
  const unassociated = await uploaded({});
  await api.publishDeployment({
    projectId,
    kind: 'static',
    artifactId: unassociated.artifactId,
    source: {},
    pinned: false,
    port: 80,
  });
  expect(projectArtifact(projectId, unassociated.artifactId).source).toEqual({});
});

test('download route streams archives and individual files, requires authentication, and enforces project scope', async () => {
  const artifact = await uploaded();
  await api.publishDeployment({
    projectId,
    kind: 'static',
    artifactId: artifact.artifactId,
    source: {},
    pinned: false,
    port: 80,
  });
  await viewer();
  const login = await auth.api.signInEmail({
    body: { email: 'artifact-viewer@example.com', password: 'deployment-caller-password' },
    asResponse: true,
  });
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join(';');
  const { default: download } =
    await import('../../../routes/api/artifacts/[artifactId]/download.get');
  const app = new H3().get('/api/artifacts/:artifactId/download', download);
  const url = `http://localhost:3000/api/artifacts/${artifact.artifactId}/download`;
  const request = (params: Record<string, string>, signedIn = true) =>
    app.fetch(
      new Request(`${url}?${new URLSearchParams(params)}`, { headers: signedIn ? { cookie } : {} }),
    );
  const response = await request({ projectId, path: 'assets/a & été.txt' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toContain('filename*=UTF-8');
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.text()).toBe('download contents');
  for (const format of ['zip', 'tar.gz']) {
    const archive = await request({ projectId, format });
    expect(archive.status).toBe(200);
    expect((await archive.arrayBuffer()).byteLength).toBeGreaterThan(50);
  }
  expect((await request({ projectId, format: 'zip' }, false)).status).toBe(401);
  db.insert(organization)
    .values({
      id: 'not-my-project',
      name: 'Other',
      slug: 'not-my-project',
      previewSlug: 'not-my-project',
    })
    .run();
  expect((await request({ projectId: 'not-my-project', format: 'zip' })).status).toBe(403);
  expect((await request({ projectId, path: '../secret' })).status).toBe(400);
  expect((await request({ projectId, path: 'missing' })).status).toBe(404);
  expect((await request({ projectId, format: 'exe' })).status).toBe(400);
});

test('streaming upload route registers source metadata, enforces roles, and cleans temporary files', async () => {
  const { makeZip } = await import('../runtime/artifacts-test-support');
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const uploader = await caller('artifact-uploader@example.com');
  db.insert(member)
    .values({
      id: 'uploader-membership',
      organizationId: projectId,
      userId: uploader.id,
      role: 'developer',
    })
    .run();
  await viewer();
  const cookieFor = async (email: string) => {
    const login = await auth.api.signInEmail({
      body: { email, password: 'deployment-caller-password' },
      asResponse: true,
    });
    return login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join(';');
  };
  const cookie = await cookieFor('artifact-uploader@example.com');
  const viewerCookie = await cookieFor('artifact-viewer@example.com');
  const { default: upload } = await import('../../../routes/api/deployments/artifacts.post');
  const app = new H3().post('/api/deployments/artifacts', upload);
  const uploadRequest = async (authCookie?: string) => {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('kind', 'static');
    form.set('source', JSON.stringify({ branch: 'upload-branch', commit: 'abc' }));
    form.set(
      'file',
      new File(
        [new Uint8Array(makeZip([{ name: 'index.html', data: 'index', method: 8 }]))],
        'site.zip',
      ),
    );
    const encoded = new Request('http://localhost:3000/api/deployments/artifacts', {
      method: 'POST',
      body: form,
    });
    const body = await encoded.arrayBuffer();
    return app.fetch(
      new Request(encoded.url, {
        method: 'POST',
        headers: {
          'content-type': encoded.headers.get('content-type')!,
          'content-length': String(body.byteLength),
          ...(authCookie ? { cookie: authCookie } : {}),
        },
        body,
      }),
    );
  };
  expect((await uploadRequest()).status).toBe(401);
  expect((await uploadRequest(viewerCookie)).status).toBe(403);
  const response = await uploadRequest(cookie);
  expect(response.status).toBe(200);
  const uploaded = (await response.json()) as { artifactId: string; size: number };
  expect(uploaded.size).toBe(5);
  expect(api.getArtifact(uploaded.artifactId, projectId).source).toMatchObject({
    branch: 'upload-branch',
    commit: 'abc',
  });
  expect(await readdir(join(deploymentStorageRoot(), 'tmp'))).toEqual([]);
});
