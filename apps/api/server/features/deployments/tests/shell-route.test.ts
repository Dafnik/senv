import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Duplex } from 'node:stream';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vite-plus/test';
import {
  automationToken,
  deployment,
  deploymentHistory,
  member,
  session,
  user,
} from '../../../../../../drizzle/schema';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import { ShellExec } from '../runtime/shell-exec';
import { deploymentInstanceId } from '../runtime/identity';
import { api, db, developerId, projectId } from './deployments.test-support';

let route: typeof import('../../../routes/api/cli/shell');
let service: typeof import('../services/shell');
let registry: typeof import('../services/shell-registry');
let resolvePrincipal: (typeof import('../../auth/services/request-principal'))['resolvePrincipal'];
const sockets = new Set<WebSocket>();
const server = createServer((_req, response) => response.writeHead(404).end());
let url: string;
const control = (value: unknown) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);
beforeAll(async () => {
  route = await import('../../../routes/api/cli/shell');
  service = await import('../services/shell');
  registry = await import('../services/shell-registry');
  ({ resolvePrincipal } = await import('../../auth/services/request-principal'));
  server.on('upgrade', (req, socket, head) => {
    void route.shellAdapter.handleUpgrade(req, socket, head);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/api/cli/shell`;
});
afterEach(async () => {
  await registry.closeShells({}, 'shutdown');
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await route.shellAdapter.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function connect(headers: Record<string, string> = {}) {
  const socket = new WebSocket(url, { headers });
  sockets.add(socket);
  socket.on('error', () => {});
  return socket;
}
async function rejected(headers: Record<string, string>) {
  const socket = connect(headers);
  return new Promise<number>((resolve) =>
    socket.once('unexpected-response', (_req, res) => {
      res.resume();
      resolve(res.statusCode!);
      socket.terminate();
    }),
  );
}
async function fixture() {
  const id = `${developerId}-${randomUUID()}`;
  db.insert(user)
    .values({ id, name: 'Shell user', email: `${id}@example.com` })
    .run();
  db.insert(member).values({ id, userId: id, organizationId: projectId, role: 'developer' }).run();
  const token = randomUUID();
  const current = db
    .insert(session)
    .values({ id, userId: id, token, expiresAt: new Date(Date.now() + 3600_000) })
    .returning()
    .get()!;
  const principal = await resolvePrincipal(new Headers({ authorization: `Bearer ${token}` }));
  const row = await api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'nginx:alpine',
    source: {},
    port: 80,
    pinned: false,
  });
  db.update(deployment).set({ status: 'healthy' }).where(eq(deployment.id, row.id)).run();
  const container = {
    Id: 'physical-origin',
    Config: {
      User: '1000',
      Labels: {
        'senv.managed': 'true',
        'senv.instance': deploymentInstanceId(),
        'senv.project': projectId,
        'senv.deployment': row.id,
        'senv.role': 'origin',
      },
    },
    State: { Running: true },
  };
  vi.spyOn(DockerEngine.prototype, 'request').mockImplementation(async (_method, path) => ({
    status: 200,
    headers: {},
    body:
      path.startsWith('/containers/') && path.endsWith('/json')
        ? container
        : path.endsWith('/json')
          ? { Running: false, ExitCode: 0 }
          : { Id: 'exec' },
  }));
  vi.spyOn(ShellExec.prototype, 'inspect').mockResolvedValue({ Running: false, ExitCode: 7 });
  const input: Buffer[] = [];
  const stream = new Duplex({
    read() {},
    write(bytes, _encoding, callback) {
      input.push(Buffer.from(bytes));
      callback();
    },
  });
  const close = vi.spyOn(ShellExec.prototype, 'close').mockImplementation(async () => {
    stream.destroy();
  });
  vi.spyOn(ShellExec.prototype, 'start').mockImplementation(async function (this: ShellExec) {
    this.stream = stream;
    return stream;
  });
  const grant = await service.createShellGrant(
    principal,
    service.shellInput.parse({ projectId, deploymentId: row.id }),
  );
  const headers = { authorization: `Bearer ${token}` };
  return { headers, principal, row, grant, input, stream, close, current, container };
}
function packets(socket: WebSocket) {
  const values: { type: string; code?: number; message?: string }[] = [];
  socket.on('message', (bytes) => {
    const frame = Buffer.from(bytes as Buffer);
    if (frame[0] === 1) values.push(JSON.parse(frame.subarray(1).toString()));
  });
  return values;
}
test('real upgrade rejects missing, invalid, impersonated, automation and browser-origin credentials', async () => {
  expect(await rejected({})).toBe(401);
  expect(await rejected({ authorization: 'Bearer invalid' })).toBe(401);
  const f = await fixture();
  expect(await rejected({ ...f.headers, origin: 'https://preview.example' })).toBe(403);
  db.update(session).set({ impersonatedBy: 'admin' }).where(eq(session.id, f.current.id)).run();
  expect(await rejected(f.headers)).toBe(403);
  expect(await rejected({ authorization: 'Bearer senv_at_invalid' })).toBe(401);
  const { hashToken } = await import('../../auth/services/request-principal');
  const secret = `senv_at_${randomUUID()}`;
  db.insert(automationToken)
    .values({
      id: secret,
      tokenHash: hashToken(secret),
      prefix: 'senv_at_',
      name: 'CI',
      userId: f.principal.user.id,
      projectId,
      permission: 'manage',
      expiresAt: null,
    })
    .run();
  expect(await rejected({ authorization: `Bearer ${secret}` })).toBe(403);
});
test('ready gates input; a pending startup frame cannot kill the shell; exit preserves the remote code', async () => {
  const f = await fixture();
  let release!: () => void;
  vi.mocked(ShellExec.prototype.start).mockImplementationOnce(async function (this: ShellExec) {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    this.stream = f.stream;
    return f.stream;
  });
  const socket = connect(f.headers);
  const messages = packets(socket);
  await once(socket, 'open');
  socket.send(control({ type: 'open', grant: f.grant.grant }));
  await vi.waitFor(() => expect(release).toBeDefined());
  socket.send(Buffer.from([0, 120]));
  socket.send(control({ type: 'resize', cols: 2000, rows: 2000 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(socket.readyState).toBe(WebSocket.OPEN);
  release();
  await vi.waitFor(() => expect(messages).toContainEqual({ type: 'ready' }));
  socket.send(Buffer.from([0, 121]));
  await vi.waitFor(() => expect(Buffer.concat(f.input).toString()).toBe('y'));
  const closed = once(socket, 'close');
  f.stream.push(null);
  await closed;
  expect(messages).toContainEqual({ type: 'exit', code: 7 });
  expect(f.close).toHaveBeenCalled();
  const replay = connect(f.headers);
  await once(replay, 'open');
  const replayClosed = once(replay, 'close');
  replay.send(control({ type: 'open', grant: f.grant.grant }));
  await replayClosed;
});
test('revocation closes a live shell immediately, drops grants and writes distinct audit reasons', async () => {
  const f = await fixture();
  const socket = connect(f.headers);
  const messages = packets(socket);
  await once(socket, 'open');
  socket.send(control({ type: 'open', grant: f.grant.grant }));
  await vi.waitFor(() => expect(messages).toContainEqual({ type: 'ready' }));
  const closed = once(socket, 'close');
  await registry.closeShells({ sessionId: f.current.id }, 'session_revoked');
  await closed;
  expect(
    messages.some((message) => message.type === 'error' && message.message === 'session revoked'),
  ).toBe(true);
  const audit = db
    .select()
    .from(deploymentHistory)
    .where(eq(deploymentHistory.deploymentId, f.row.id))
    .all();
  expect(audit).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'shell.closed',
        details: expect.objectContaining({ reason: 'session_revoked' }),
      }),
      expect.objectContaining({ event: 'shell.revoked' }),
    ]),
  );
});
test('the Node adapter rejects oversized frames before application buffering', async () => {
  const f = await fixture();
  const socket = connect(f.headers);
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send(Buffer.alloc(64 * 1024 + 1));
  const [code] = await closed;
  expect(code).toBe(1009);
});

test('idle, lifetime and heartbeat timeouts use distinct audit reasons through the real route', async () => {
  for (const [reason, advance] of [
    ['heartbeat_timeout', 31_000],
    ['idle_timeout', 16 * 60_000],
    ['max_lifetime', 2 * 3600_000 + 1],
  ] as const) {
    const f = await fixture();
    let check!: () => Promise<void>;
    const interval = globalThis.setInterval;
    const timerSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => Promise<void>,
      ms: number,
    ) => {
      if (ms === 5000) check = callback;
      return interval(callback, ms);
    }) as typeof setInterval);
    const socket = connect(f.headers);
    const messages = packets(socket);
    await once(socket, 'open');
    socket.send(control({ type: 'open', grant: f.grant.grant }));
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'ready' }));
    // Lifetime check has priority once both lifetime and idle expire.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + advance);
    const closed = once(socket, 'close');
    await check();
    await closed;
    clock.mockRestore();
    timerSpy.mockRestore();
    const audit = db
      .select()
      .from(deploymentHistory)
      .where(eq(deploymentHistory.deploymentId, f.row.id))
      .all();
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'shell.timeout',
          details: expect.objectContaining({ reason }),
        }),
      ]),
    );
    vi.restoreAllMocks();
  }
});

test('the per-user concurrency limit denies the fifth shell and records its denial', async () => {
  const f = await fixture();
  const input = service.shellInput.parse({ projectId, deploymentId: f.row.id });
  for (let index = 0; index < 5; index++) {
    const grant = index === 0 ? f.grant : await service.createShellGrant(f.principal, input);
    const socket = connect(f.headers);
    const messages = packets(socket);
    await once(socket, 'open');
    if (index === 4) {
      const closed = once(socket, 'close');
      socket.send(control({ type: 'open', grant: grant.grant }));
      await closed;
    } else {
      socket.send(control({ type: 'open', grant: grant.grant }));
      await vi.waitFor(() => expect(messages).toContainEqual({ type: 'ready' }));
    }
  }
  expect(registry.shellConnections.size).toBe(4);
  expect(
    db.select().from(deploymentHistory).where(eq(deploymentHistory.deploymentId, f.row.id)).all(),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'shell.denied' })]));
});

test('leaving a project through Better Auth immediately closes shells and invalidates unused grants', async () => {
  const f = await fixture();
  const unused = await service.createShellGrant(
    f.principal,
    service.shellInput.parse({ projectId, deploymentId: f.row.id }),
  );
  const socket = connect(f.headers);
  const messages = packets(socket);
  await once(socket, 'open');
  socket.send(control({ type: 'open', grant: f.grant.grant }));
  await vi.waitFor(() => expect(messages).toContainEqual({ type: 'ready' }));
  const closed = once(socket, 'close');
  const { auth } = await import('../../auth/auth');
  const response = await auth.handler(
    new Request('http://localhost:3000/api/auth/organization/leave', {
      method: 'POST',
      headers: {
        ...f.headers,
        origin: 'http://localhost:4200',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ organizationId: projectId }),
    }),
  );
  expect(response.status).toBe(200);
  await closed;
  expect(messages.some((message) => message.message === 'permission lost')).toBe(true);
  await expect(service.consumeShellGrant(f.principal, unused.grant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});

test('expired grants are denied and audited; relative paths and wrong projects cannot be probed', async () => {
  const f = await fixture();
  expect(
    service.shellInput.safeParse({ projectId, deploymentId: f.row.id, executable: 'bin/sh' })
      .success,
  ).toBe(false);
  await expect(
    service.createShellGrant(
      f.principal,
      service.shellInput.parse({ projectId: 'other-project', deploymentId: f.row.id }),
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001);
  await expect(service.consumeShellGrant(f.principal, f.grant.grant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  clock.mockRestore();
  expect(
    db.select().from(deploymentHistory).where(eq(deploymentHistory.deploymentId, f.row.id)).all(),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'shell.denied',
        details: expect.objectContaining({ reason: 'grant_rejected' }),
      }),
    ]),
  );
});

test('default probes fall back to bash; explicit paths are respected and shell-less images fail clearly', async () => {
  const f = await fixture();
  const paths: string[] = [];
  vi.mocked(DockerEngine.prototype.request).mockImplementation(async (_method, path, body) => {
    if (path.startsWith('/containers/') && path.endsWith('/json'))
      return { status: 200, headers: {}, body: f.container };
    if (path.endsWith('/exec')) {
      const executable = (body as { Cmd: string[] }).Cmd[0]!;
      paths.push(executable);
      if (executable !== '/bin/bash' && executable !== '/custom/bash')
        throw new Error('Executable missing');
      return { status: 200, headers: {}, body: { Id: 'exec' } };
    }
    return { status: 200, headers: {}, body: { ExitCode: 0 } };
  });
  const input = service.shellInput.parse({ projectId, deploymentId: f.row.id });
  expect(await service.createShellGrant(f.principal, input)).toMatchObject({
    executable: '/bin/bash',
  });
  expect(paths).toEqual(['/bin/sh', '/bin/bash']);
  paths.length = 0;
  expect(
    await service.createShellGrant(f.principal, { ...input, executable: '/custom/bash' }),
  ).toMatchObject({ executable: '/custom/bash' });
  expect(paths).toEqual(['/custom/bash']);
  await expect(
    service.createShellGrant(f.principal, { ...input, executable: '/missing' }),
  ).rejects.toThrow('no supported POSIX shell');
});
