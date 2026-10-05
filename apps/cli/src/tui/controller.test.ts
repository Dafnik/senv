import { afterEach, expect, test, vi } from 'vite-plus/test';
import { TuiController } from './controller.ts';
import { CliError } from '../errors.ts';
import { detailViewport } from './viewport.ts';
import type { ClientContext } from '../api/client.ts';
import {
  loadDeployment as loadDeploymentView,
  row,
  type Access,
  type Identity,
  type Page,
} from './workspace.ts';

const controllers: TuiController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
  vi.unstubAllEnvs();
});
function setup(
  access: Access = {
    kind: 'personal',
    projectId: null,
    permission: null,
    impersonated: false,
    sessionId: 'session',
  },
) {
  const identity = {
    id: 'user',
    email: 'user@example.com',
    name: 'User',
    role: 'admin',
    emailVerified: true,
  } as Identity;
  const project = { id: 'project', name: 'Project', previewSlug: 'project', role: 'admin' };
  const client = {
    me: { query: vi.fn(async () => identity) },
    cli: {
      access: { query: vi.fn(async () => access) },
      project: { query: vi.fn(async () => project) },
      createToken: {
        mutate: vi.fn(async () => ({
          id: 'new-token',
          secret: 'senv_at_one_time_secret',
          expiresAt: new Date('2030-01-01'),
        })),
      },
    },
    deployments: {
      list: { query: vi.fn(async () => ({ deployments: [] })) },
      uploadConstraints: { query: vi.fn(async () => ({ maxBytes: 100_000, maxEntries: 100 })) },
      logsForward: {
        query: vi.fn(async () => ({
          logs: [],
          afterSequence: 0,
          hasMore: false,
          retentionGap: false,
        })),
      },
    },
    projects: { create: { mutate: vi.fn(async () => ({ id: 'created', name: 'New' })) } },
  } as unknown as ClientContext['client'];
  const context = {
    name: 'test',
    token: 'personal-bearer-secret',
    profile: { apiUrl: 'http://localhost:3000' },
    configuration: { profiles: {}, credentials: {} },
    client,
    project: async () => project.id,
  } as ClientContext;
  const loadScreen = vi.fn(async (): Promise<Page> => ({
    rows: [row('first', 'First', '', {})],
    hasNext: false,
  }));
  const loadDeployment = vi.fn(async (..._args: Parameters<typeof loadDeploymentView>) =>
    row('first', 'First', '', {}, ['details']),
  );
  const selectProject = vi.fn(async () => project);
  const c = new TuiController(
    { project: 'project' },
    {
      resolveContext: async () => context,
      apiClient: () => client,
      selectProject,
      loadScreen,
      loadDeployment,
    },
  );
  controllers.push(c);
  return { c, client, context, loadScreen, loadDeployment, selectProject };
}
async function idle(c: TuiController) {
  await vi.waitFor(() => expect(c.snapshot().busy || c.snapshot().loading).toBe(false));
}
function action(c: TuiController, label: string) {
  c.actions();
  const modal = c.snapshot().modal;
  if (modal?.kind !== 'menu') throw new Error('No actions');
  const index = modal.actions.findIndex((a) => a.label === label);
  expect(index).toBeGreaterThanOrEqual(0);
  c.modalMove(index);
  c.modalActivate();
}
test('automation access exposes only project/deployment navigation and denies personal and write actions', async () => {
  const { c } = setup({
    kind: 'automation',
    projectId: 'project',
    permission: 'read',
    impersonated: false,
    sessionId: null,
  });
  await c.start();
  expect(c.snapshot().navigation).toEqual(['Projects', 'Instances']);
  expect(c.tabs()).toEqual(['Deployments', 'History']);
  c.actions();
  const modal = c.snapshot().modal;
  expect(modal?.kind).toBe('menu');
  if (modal?.kind !== 'menu') return;
  expect(modal.actions.find((a) => a.label === 'Publish deployment')?.disabled).toContain('manage');
  expect(JSON.stringify(c.snapshot())).not.toContain('personal-bearer-secret');
});
test('stale read responses cannot overwrite a newly selected view', async () => {
  const { c, loadScreen } = setup();
  await c.start();
  let complete!: (value: Page) => void;
  loadScreen.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = c.refresh();
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  c.navigate('Sessions');
  await idle(c);
  complete({ rows: [row('stale', 'Stale', '', {})], hasNext: false });
  await pending;
  expect(c.snapshot().screen).toBe('Sessions');
  expect(c.snapshot().rows.map((r) => r.id)).toEqual(['first']);
});
test('discard cancellation preserves the draft and letter keys remain form values', async () => {
  const { c } = setup();
  await c.start();
  c.navigate('Projects');
  await idle(c);
  action(c, 'Create project');
  c.editField('qra/?');
  c.back();
  expect(c.snapshot().modal?.kind).toBe('confirm');
  c.modalActivate(); // Cancel is the default.
  const modal = c.snapshot().modal;
  expect(modal?.kind).toBe('form');
  if (modal?.kind === 'form') expect(modal.fields[0]?.value).toBe('qra/?');
});
test('review precedes submission and repeated activation cannot duplicate a mutation', async () => {
  const { c, client } = setup();
  await c.start();
  c.navigate('Projects');
  await idle(c);
  let complete!: () => void;
  vi.mocked(client.projects.create.mutate).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = () =>
          resolve({ id: 'created' } as Awaited<ReturnType<typeof client.projects.create.mutate>>);
      }),
  );
  action(c, 'Create project');
  c.editField('New');
  c.modalActivate();
  expect(client.projects.create.mutate).not.toHaveBeenCalled();
  c.modalActivate();
  c.modalActivate();
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  expect(client.projects.create.mutate).toHaveBeenCalledTimes(1);
  complete();
  await idle(c);
});
test('one-time token secrets exist only in the reveal modal and clear on leaving it', async () => {
  const { c } = setup();
  await c.start();
  c.navigate('Automation tokens');
  await idle(c);
  action(c, 'Create project token');
  c.editField('CI');
  c.modalActivate();
  c.modalActivate();
  await idle(c);
  expect(c.snapshot().modal).toMatchObject({ kind: 'message', secret: true });
  expect(JSON.stringify(c.snapshot())).toContain('senv_at_one_time_secret');
  c.closeModal();
  await idle(c);
  expect(JSON.stringify(c.snapshot())).not.toContain('senv_at_one_time_secret');
});
test('revoked authentication clears protected rows, details and navigation', async () => {
  const { c, client } = setup();
  await c.start();
  await c.activate();
  vi.mocked(client.me.query).mockRejectedValueOnce(new CliError('revoked', 3));
  await c.refresh();
  expect(c.snapshot()).toMatchObject({
    account: 'signed out',
    rows: [],
    detail: undefined,
    navigation: ['Account', 'Instances'],
    follow: false,
    watch: false,
  });
});
test('log follow drains forward pages, deduplicates entries and reports retention gaps', async () => {
  const { c, client } = setup();
  await c.start();
  await c.activate();
  vi.mocked(client.deployments.logsForward.query)
    .mockResolvedValueOnce({
      logs: [
        {
          id: 'a',
          sequence: 1,
          deploymentId: 'first',
          source: 'origin',
          createdAt: new Date(),
          content: 'one',
        },
      ],
      afterSequence: 1,
      hasMore: true,
      retentionGap: false,
    })
    .mockResolvedValueOnce({
      logs: [
        {
          id: 'a',
          sequence: 1,
          deploymentId: 'first',
          source: 'origin',
          createdAt: new Date(),
          content: 'one',
        },
        {
          id: 'b',
          sequence: 2,
          deploymentId: 'first',
          source: 'origin',
          createdAt: new Date(),
          content: 'two',
        },
      ],
      afterSequence: 2,
      hasMore: false,
      retentionGap: true,
    });
  await c.tab(2);
  expect(c.snapshot().detail?.lines.filter((line) => line === 'one')).toHaveLength(1);
  expect(c.snapshot().detail?.lines).toContain('two');
  expect(c.snapshot().status).toContain('Retention gap');
  expect(client.deployments.logsForward.query).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ afterSequence: 1 }),
  );
});
test('an ambiguous mutation failure is reported without automatic resubmission', async () => {
  const { c, client } = setup();
  await c.start();
  c.navigate('Projects');
  await idle(c);
  vi.mocked(client.projects.create.mutate).mockRejectedValueOnce(
    new Error('response lost personal-bearer-secret'),
  );
  action(c, 'Create project');
  c.editField('New');
  c.modalActivate();
  c.modalActivate();
  await idle(c);
  expect(c.snapshot().status).toContain('unknown');
  expect(c.snapshot().error).not.toContain('personal-bearer-secret');
  expect(client.projects.create.mutate).toHaveBeenCalledTimes(1);
});
test('confirming discard closes the draft and permits quitting', async () => {
  const { c } = setup();
  await c.start();
  c.navigate('Projects');
  await idle(c);
  action(c, 'Create project');
  c.editField('draft');
  c.back();
  c.modalMove(1);
  c.modalActivate();
  expect(c.snapshot().modal).toBeUndefined();
  const quit = vi.fn();
  c.onQuit = quit;
  c.requestQuit();
  expect(quit).toHaveBeenCalledWith(0);
});
test('publication review displays authoritative upload bounds before any remote submission', async () => {
  const { c, client } = setup();
  await c.start();
  action(c, 'Publish deployment');
  await idle(c);
  c.modalMove(1);
  c.editField('/local/dist');
  c.modalActivate();
  expect(c.snapshot().modal).toMatchObject({
    kind: 'form',
    review: true,
    notice: [
      'Upload limit: 100000 bytes; 100 entries.',
      'The server applies existing project configuration.',
    ],
  });
  expect(client.deployments.uploadConstraints.query).toHaveBeenCalledWith({ projectId: 'project' });
  c.back();
  expect(c.snapshot().modal).toMatchObject({ kind: 'form', review: false });
});
test('project access loss clears its actions without signing out the account', async () => {
  const { c, selectProject } = setup();
  await c.start();
  selectProject.mockRejectedValueOnce(new CliError('membership removed', 4));
  await c.refresh();
  expect(c.snapshot()).toMatchObject({
    rows: [],
    projectId: undefined,
    project: 'select a project',
  });
  expect(c.snapshot().account).toBe('user@example.com');
  c.actions();
  const modal = c.snapshot().modal;
  if (modal?.kind !== 'menu') throw new Error('No actions');
  expect(modal.actions.find((a) => a.label === 'Publish deployment')?.disabled).toBeTruthy();
});
test('tag review shows its existing deployment target before moving the address', async () => {
  const { c, client } = setup();
  await c.start();
  vi.mocked(client.deployments.list.query).mockResolvedValueOnce({
    deployments: [{ id: 'old-target', tags: ['staging'] }],
  } as Awaited<ReturnType<typeof client.deployments.list.query>>);
  action(c, 'Assign / move preview tag');
  await idle(c);
  c.editField('staging');
  c.modalActivate();
  expect(c.snapshot().modal).toMatchObject({
    kind: 'form',
    review: true,
    notice: expect.arrayContaining(['Current target: old-target', 'New target: first']),
  });
});

test('empty automation duration submits no expiry and the reveal view renders Never', async () => {
  const { c, client } = setup();
  vi.mocked(client.cli.createToken.mutate).mockResolvedValueOnce({
    id: '00000000-0000-4000-8000-000000000001',
    secret: 'senv_at_one_time_secret',
    expiresAt: null,
  });
  await c.start();
  c.navigate('Automation tokens');
  await idle(c);
  action(c, 'Create project token');
  c.editField('CI');
  c.modalMove(3);
  c.editField('', false, 0, true);
  c.modalActivate();
  c.modalActivate();
  await idle(c);
  expect(client.cli.createToken.mutate).toHaveBeenCalledWith({
    name: 'CI',
    projectId: 'project',
    permission: 'read',
    expiresInSeconds: null,
  });
  expect(JSON.stringify(c.snapshot().modal)).toContain('Never');
});

test('project and account tabs share a small sidebar and clear view state when switching', async () => {
  const { c } = setup();
  await c.start();
  expect(c.snapshot().navigation).toEqual(['Projects', 'Account', 'Administration', 'Instances']);
  expect(c.tabs()).toEqual(['Deployments', 'History', 'Members', 'Invitations']);
  c.search('previous view');
  await c.tab(1);
  await idle(c);
  expect(c.snapshot()).toMatchObject({
    screen: 'History',
    query: '',
    page: 0,
    navIndex: 0,
    status: 'Connected',
  });
  c.navigate('Account');
  await idle(c);
  expect(c.tabs()).toEqual(['Account', 'Sessions', 'Automation tokens']);
  await c.tab(-1);
  expect(c.snapshot()).toMatchObject({ screen: 'Automation tokens', navIndex: 1 });
  c.navigate('Users');
  await idle(c);
  await c.tab(1);
  expect(c.snapshot()).toMatchObject({ screen: 'Instance statistics', navIndex: 2 });
});

test('focus moves through navigation, tabs, and content in both directions', async () => {
  const { c } = setup();
  await c.start();
  c.toggleFocus();
  expect(c.snapshot().focus).toBe('navigation');
  c.move(1);
  await c.tab(1); // Left/Right must not switch content while choosing a destination.
  expect(c.snapshot().screen).toBe('Deployments');
  await c.activate();
  await idle(c);
  expect(c.snapshot()).toMatchObject({ screen: 'Account', focus: 'content' });
  c.toggleFocus(true);
  expect(c.snapshot().focus).toBe('tabs');
  await c.tab(1);
  expect(c.snapshot()).toMatchObject({ screen: 'Sessions', focus: 'tabs' });
  await c.activate();
  expect(c.snapshot().focus).toBe('content');
  c.navigate('Projects');
  await idle(c);
  c.toggleFocus(true);
  expect(c.snapshot().focus).toBe('navigation');
});

test('Esc returns from deployment details to its list, then to the project picker', async () => {
  const { c, loadScreen } = setup();
  await c.start();
  await c.activate();
  expect(c.snapshot().detail?.id).toBe('first');
  await c.tab(1);
  expect(c.snapshot().tab).toBe('Addresses');
  expect(c.snapshot().screen).toBe('Deployments');
  c.back();
  await idle(c);
  expect(c.snapshot()).toMatchObject({
    screen: 'Deployments',
    detail: undefined,
    projectId: 'project',
  });
  loadScreen.mockResolvedValueOnce({ rows: [row('project', 'Project', '', {})], hasNext: false });
  c.back();
  await idle(c);
  expect(c.snapshot()).toMatchObject({ screen: 'Projects', focus: 'content' });
  await c.activate();
  await idle(c);
  expect(c.snapshot().screen).toBe('Deployments');
});

test('permission changes remove account and administration tabs before loading them', async () => {
  const { c, client, loadScreen } = setup();
  await c.start();
  c.navigate('Sessions');
  await idle(c);
  vi.mocked(client.cli.access.query).mockResolvedValue({
    kind: 'automation',
    projectId: 'project',
    permission: 'read',
    impersonated: false,
    sessionId: null,
  });
  loadScreen.mockClear();
  await c.refresh();
  await idle(c);
  expect(c.snapshot()).toMatchObject({ screen: 'Projects', navigation: ['Projects', 'Instances'] });
  expect(loadScreen.mock.calls.every((call) => (call as unknown[])[1] !== 'Sessions')).toBe(true);
  c.navigate('Account');
  expect(c.snapshot().screen).toBe('Projects');
  c.navigate('Deployments');
  await idle(c);
  expect(c.tabs()).toEqual(['Deployments', 'History']);
});

test('project picker offers invitation lookup without a selected project', async () => {
  const { c, selectProject } = setup();
  selectProject.mockRejectedValue(new CliError('Select a project.', 2));
  await c.start();
  expect(c.snapshot().screen).toBe('Projects');
  action(c, 'Invitations / look up invitation ID');
  await idle(c);
  expect(c.snapshot().screen).toBe('Invitations');
  action(c, 'Look up invitation ID');
  expect(c.snapshot().modal).toMatchObject({ kind: 'form', title: 'Inspect invitation' });
});

test('scrolling up from following logs starts at the visible tail and stays put as output arrives', async () => {
  const { c, client } = setup();
  await c.start();
  await c.activate();
  const entries = Array.from({ length: 50 }, (_, index) => ({
    id: `log-${index}`,
    sequence: index + 1,
    deploymentId: 'first',
    source: 'origin' as const,
    createdAt: new Date(),
    content: `Output ${index}`,
  }));
  vi.mocked(client.deployments.logsForward.query).mockResolvedValueOnce({
    logs: entries,
    afterSequence: 50,
    hasMore: false,
    retentionGap: false,
  });
  await c.tab(2);
  const bottom = detailViewport(c.snapshot(), 100, 24).maximum;
  expect(bottom).toBeGreaterThan(0);
  expect(c.snapshot()).toMatchObject({ scroll: bottom, autoScroll: true });
  c.move(-1);
  expect(c.snapshot()).toMatchObject({ scroll: bottom - 1, autoScroll: false });
  vi.mocked(client.deployments.logsForward.query).mockResolvedValueOnce({
    logs: [{ ...entries[0]!, id: 'new', sequence: 51, content: 'New output' }],
    afterSequence: 51,
    hasMore: false,
    retentionGap: false,
  });
  await c.refresh();
  expect(c.snapshot()).toMatchObject({ scroll: bottom - 1, autoScroll: false });
  c.move(2);
  expect(c.snapshot()).toMatchObject({ scroll: bottom + 1, autoScroll: true });
  c.jump(false);
  expect(c.snapshot()).toMatchObject({ scroll: 0, autoScroll: false });
  c.jump(true);
  expect(c.snapshot()).toMatchObject({ scroll: bottom + 1, autoScroll: true });
});

for (const tab of ['Overview', 'History'] as const) {
  test(`${tab} bounds scroll state so reversing at either edge moves immediately`, async () => {
    const { c, loadDeployment } = setup();
    loadDeployment.mockResolvedValue(
      row(
        'first',
        'Long details',
        '',
        { hasNext: true },
        Array.from({ length: 100 }, (_, index) => `Line ${index}`),
      ),
    );
    await c.start();
    await c.activate();
    if (tab === 'History') await c.tab(4);
    const bottom = detailViewport(c.snapshot(), 100, 24).maximum;
    c.jump(true);
    for (let index = 0; index < 200; index++) c.move(1);
    expect(c.snapshot().scroll).toBe(bottom);
    c.move(-1);
    expect(c.snapshot().scroll).toBe(bottom - 1);
    c.setScroll(Number.MAX_SAFE_INTEGER);
    c.move(-1);
    expect(c.snapshot().scroll).toBe(bottom - 1);
    c.jump(false);
    for (let index = 0; index < 200; index++) c.move(-1);
    c.move(1);
    expect(c.snapshot().scroll).toBe(1);
    c.setViewport(140, 140);
    expect(c.snapshot().scroll).toBe(0);
    c.move(1);
    expect(c.snapshot().scroll).toBe(0);
  });
}

test('viewport resize clamps a paused log position and preserves following at the actual bottom', async () => {
  const { c, client } = setup();
  await c.start();
  await c.activate();
  vi.mocked(client.deployments.logsForward.query).mockResolvedValueOnce({
    logs: [
      {
        id: 'log',
        sequence: 1,
        deploymentId: 'first',
        source: 'origin',
        createdAt: new Date(),
        content: Array.from({ length: 50 }, (_, index) => `Line ${index}`).join('\n'),
      },
    ],
    afterSequence: 1,
    hasMore: false,
    retentionGap: false,
  });
  await c.tab(2);
  c.setViewport(40, 12);
  expect(c.snapshot().scroll).toBe(detailViewport(c.snapshot(), 40, 12).maximum);
  c.move(-1);
  c.setViewport(140, 40);
  const bottom = detailViewport(c.snapshot(), 140, 40).maximum;
  expect(c.snapshot()).toMatchObject({ scroll: bottom, autoScroll: false });
  c.move(-1);
  expect(c.snapshot().scroll).toBe(bottom - 1);
});

test('history search returns to its first page and retains event and actor filters', async () => {
  const { c, loadDeployment } = setup();
  loadDeployment.mockImplementation(async (_ctx, _project, _id, _tab, _options, previous) =>
    row('first', 'History', '', { offset: previous?.data.offset ?? 0, hasNext: true }, [
      'Tag assigned',
    ]),
  );
  await c.start();
  await c.activate();
  await c.tab(4);
  expect(c.tabs()).toEqual(['Overview', 'Addresses', 'Logs', 'Resources', 'History']);
  await c.page(1);
  expect(c.snapshot().detail?.data.offset).toBe(40);
  c.search('production');
  c.finishSearch();
  await idle(c);
  expect(loadDeployment).toHaveBeenLastCalledWith(
    expect.anything(),
    'project',
    'first',
    'History',
    expect.objectContaining({ query: 'production' }),
    expect.objectContaining({ data: expect.objectContaining({ offset: 0 }) }),
  );
  action(c, 'Filter history events and actors');
  c.editField('tag-assigned');
  c.modalMove(1);
  c.editField('system');
  c.modalActivate();
  c.modalActivate();
  await idle(c);
  expect(loadDeployment.mock.calls.at(-1)?.[4]).toMatchObject({
    historyEvent: 'tag-assigned',
    historyActor: 'system',
  });
  expect(c.snapshot().detail?.data.offset).toBe(0);
});
