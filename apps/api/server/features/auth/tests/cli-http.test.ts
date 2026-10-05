import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vite-plus/test';
import { createProgram } from '../../../../../cli/src/program';
import { TuiController } from '../../../../../cli/src/tui/controller';
import { writeConfiguration } from '../../../../../cli/src/profiles';
import { session } from '../../../../../../drizzle/schema';
import { adminCookie, auth, db } from './setup.test-support';

test('Commander commands operate against the real auth/tRPC HTTP handlers with native bearer requests', async () => {
  await adminCookie();
  const personal = db.select().from(session).all().at(-1)!;
  const { default: trpc } = await import('../../../trpc/trpc-handler');
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const request = new Request(`http://localhost${incoming.url}`, {
        method: incoming.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await (incoming.url?.startsWith('/api/auth')
        ? auth.handler(request)
        : trpc.fetch(request));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500);
      outgoing.end(String(error));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'senv-cli-http-'));
  vi.stubEnv('SENV_CONFIG_DIR', directory);
  vi.stubEnv('SENV_INSTANCE', 'test');
  vi.stubEnv('SENV_TOKEN', personal.token);
  const address = server.address() as { port: number };
  await writeConfiguration({
    active: 'test',
    profiles: { test: { apiUrl: `http://127.0.0.1:${address.port}` } },
    credentials: {},
  });
  let stdout = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const run = async (...args: string[]) => {
    stdout = '';
    await createProgram().parseAsync(['--json', ...args], { from: 'user' });
    return JSON.parse(stdout);
  };
  try {
    expect(await run('auth', 'whoami')).toMatchObject({ email: 'admin@example.com' });
    const project = await run('projects', 'create', 'HTTP project');
    // Set this to an outside-repository installation for the release smoke check.
    const installed = process.env['SENV_PACKED_CLI'];
    if (installed) {
      const result = await promisify(execFile)(
        'python3',
        [
          fileURLToPath(new URL('../../../../../cli/scripts/test-terminal.py', import.meta.url)),
          process.execPath,
          installed,
          'account',
          `http://127.0.0.1:${address.port}`,
          personal.token,
        ],
        { timeout: 20_000 },
      );
      expect(JSON.parse(result.stdout)).toEqual({ mode: 'account', restored: true });
    }
    expect(await run('--project', project.previewSlug, 'projects', 'show')).toMatchObject({
      id: project.id,
    });
    expect(await run('--project', project.previewSlug, 'deployments', 'list')).toEqual([]);
    const created = await run('users', 'create', 'Invited user', 'cli-managed@example.com');
    expect(created.signupEmailSent).toBe(true);
    expect(await run('users', 'show', created.user.id)).toMatchObject({
      email: 'cli-managed@example.com',
    });
    expect(await run('users', 'resend-signup', created.user.id)).toMatchObject({ status: true });
    const token = await run('--project', project.id, 'auth', 'tokens', 'create', 'CI');
    vi.stubEnv('SENV_INSTANCE', 'test');
    vi.stubEnv('SENV_TOKEN', token.secret);
    expect(await run('--project', project.id, 'deployments', 'list')).toEqual([]);
    await expect(run('users', 'list')).rejects.toMatchObject({ exitCode: 3 });
    await expect(
      run('--project', project.id, 'projects', 'rename', 'Forbidden'),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    const automationTui = new TuiController({ project: project.id });
    try {
      await automationTui.start();
      expect(automationTui.snapshot().navigation).not.toContain('Administration');
      expect(automationTui.snapshot().navigation).not.toContain('Sessions');
      expect(automationTui.snapshot()).toMatchObject({
        projectId: project.id,
        account: 'automation (read)',
        screen: 'Deployments',
      });
    } finally {
      automationTui.dispose();
    }
    vi.stubEnv('SENV_INSTANCE', 'test');
    vi.stubEnv('SENV_TOKEN', personal.token);
    const tui = new TuiController({ project: project.id });
    try {
      await tui.start();
      expect(tui.snapshot().navigation).toContain('Administration');
      for (const [screen, expected] of [
        ['Sessions', personal.id],
        ['Automation tokens', token.id],
        ['Users', created.user.id],
      ] as const) {
        tui.navigate(screen);
        await vi.waitFor(() => {
          expect(tui.snapshot().loading).toBe(false);
          expect(tui.snapshot().rows.some((row) => row.id === expected)).toBe(true);
        });
      }
      tui.navigate('Projects');
      await vi.waitFor(() => expect(tui.snapshot().loading).toBe(false));
      tui.actions();
      const menu = tui.snapshot().modal;
      if (menu?.kind !== 'menu') throw new Error('Missing action menu');
      tui.modalMove(menu.actions.findIndex((action) => action.label === 'Create project'));
      tui.modalActivate();
      tui.editField('Created through TUI');
      tui.modalActivate(); // Review does not submit.
      expect(tui.snapshot().modal).toMatchObject({ kind: 'form', review: true });
      tui.modalActivate();
      await vi.waitFor(() => {
        expect(tui.snapshot().busy).toBe(false);
        expect(tui.snapshot().modal).toMatchObject({ kind: 'message', title: 'Project created' });
      });
      expect(await run('projects', 'list')).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Created through TUI' })]),
      );
      expect(JSON.stringify(tui.snapshot())).not.toContain(personal.token);
    } finally {
      tui.dispose();
    }
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
