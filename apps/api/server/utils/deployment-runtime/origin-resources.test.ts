import { expect, test } from 'vite-plus/test';
import { DockerEngine, type DockerResponse } from '../docker-engine';
import { convertDockerStats, readOriginResourceSample } from './origin-resources';

class StatsDocker extends DockerEngine {
  readonly paths: string[] = [];
  inspect: unknown = {
    Id: 'origin-123',
    State: { Running: true },
    Config: {
      Labels: {
        'senv.managed': 'true',
        'senv.instance': 'test',
        'senv.deployment': 'deployment-1',
        'senv.project': 'project-1',
        'senv.role': 'origin',
      },
    },
  };
  stats: unknown = {
    cpu_stats: {
      cpu_usage: { total_usage: 250 },
      system_cpu_usage: 1000,
      online_cpus: 2,
    },
    precpu_stats: { cpu_usage: { total_usage: 150 }, system_cpu_usage: 800 },
    memory_stats: {
      usage: 80,
      limit: 100,
      stats: { inactive_file: 20 },
    },
  };
  statsError = false;

  override async request<T = unknown>(method: string, path: string): Promise<DockerResponse<T>> {
    this.paths.push(`${method} ${path}`);
    if (path.endsWith('/json')) {
      if (this.inspect === null)
        throw new Error('Docker Engine GET container failed (404): missing');
      return { status: 200, headers: {}, body: this.inspect as T };
    }
    if (this.statsError) throw new Error('Docker stats unavailable');
    return { status: 200, headers: {}, body: this.stats as T };
  }
}

test('converts Docker CPU deltas and memory working set', () => {
  expect(
    convertDockerStats({
      cpu_stats: { cpu_usage: { total_usage: 250 }, system_cpu_usage: 1000, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 150 }, system_cpu_usage: 800 },
      memory_stats: { usage: 80, limit: 100, stats: { inactive_file: 20 } },
    }),
  ).toEqual({ cpuPercent: 100, memoryUsedBytes: 60, memoryLimitBytes: 100 });
});

test('keeps a valid zero CPU delta as a real zero reading', () => {
  expect(
    convertDockerStats({
      cpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 100, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 80 },
      memory_stats: { usage: 50, limit: 100 },
    })?.cpuPercent,
  ).toBe(0);
});

test('uses cgroup v1 total_inactive_file when available', () => {
  const sample = convertDockerStats({
    cpu_stats: { cpu_usage: { total_usage: 2 }, system_cpu_usage: 2, online_cpus: 1 },
    precpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 1 },
    memory_stats: { usage: 90, limit: 100, stats: { total_inactive_file: 30 } },
  });
  expect(sample?.memoryUsedBytes).toBe(60);
});

test('prefers cgroup v1 hierarchical inactive bytes if both Docker fields are present', () => {
  const sample = convertDockerStats({
    cpu_stats: { cpu_usage: { total_usage: 2 }, system_cpu_usage: 2, online_cpus: 1 },
    precpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 1 },
    memory_stats: {
      usage: 90,
      limit: 100,
      stats: { inactive_file: 10, total_inactive_file: 30 },
    },
  });
  expect(sample?.memoryUsedBytes).toBe(60);
});

test('uses the per-cpu counter count when Docker omits online_cpus', () => {
  const sample = convertDockerStats({
    cpu_stats: {
      cpu_usage: { total_usage: 5, percpu_usage: [1, 2, 3] },
      system_cpu_usage: 10,
    },
    precpu_stats: { cpu_usage: { total_usage: 3 }, system_cpu_usage: 8 },
    memory_stats: { usage: 50, limit: 100 },
  });
  expect(sample?.cpuPercent).toBe(300);
});

test('rejects missing or reset CPU counters instead of inventing a reading', () => {
  const base = {
    cpu_stats: { cpu_usage: { total_usage: 20 }, system_cpu_usage: 100, online_cpus: 2 },
    precpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 80 },
    memory_stats: { usage: 50, limit: 100 },
  };
  expect(convertDockerStats({ ...base, precpu_stats: undefined })).toBeNull();
  expect(
    convertDockerStats({
      ...base,
      cpu_stats: { ...base.cpu_stats, cpu_usage: { total_usage: 5 } },
    }),
  ).toBeNull();
});

test('returns unavailable when Docker omits required sample fields', async () => {
  const engine = new StatsDocker();
  engine.stats = { cpu_stats: {}, memory_stats: {} };
  const sample = await readOriginResourceSample({
    engine,
    instanceId: 'test',
    projectId: 'project-1',
    deploymentId: 'deployment-1',
  });
  expect(sample.status).toBe('unavailable');
  if (sample.status === 'unavailable') expect(sample.reason).toBe('stats-unavailable');
});

test('reports missing and stopped containers without requesting stats', async () => {
  const engine = new StatsDocker();
  engine.inspect = null;
  const missing = await readOriginResourceSample({
    engine,
    instanceId: 'test',
    projectId: 'project-1',
    deploymentId: 'deployment-1',
  });
  expect(missing).toMatchObject({ status: 'unavailable', reason: 'container-missing' });

  engine.inspect = {
    Id: 'origin-123',
    State: { Running: false },
    Config: {
      Labels: {
        'senv.managed': 'true',
        'senv.instance': 'test',
        'senv.deployment': 'deployment-1',
        'senv.project': 'project-1',
        'senv.role': 'origin',
      },
    },
  };
  const stopped = await readOriginResourceSample({
    engine,
    instanceId: 'test',
    projectId: 'project-1',
    deploymentId: 'deployment-1',
  });
  expect(stopped).toMatchObject({ status: 'unavailable', reason: 'container-stopped' });
  expect(engine.paths).toHaveLength(2);
});

test('does not read stats for containers with mismatched ownership labels', async () => {
  const engine = new StatsDocker();
  for (const label of ['senv.instance', 'senv.project', 'senv.role']) {
    const inspect = engine.inspect as { Config: { Labels: Record<string, string> } };
    inspect.Config.Labels[label] = 'wrong-owner';
    const result = await readOriginResourceSample({
      engine,
      instanceId: 'test',
      projectId: 'project-1',
      deploymentId: 'deployment-1',
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'container-missing' });
    inspect.Config.Labels[label] =
      label === 'senv.instance' ? 'test' : label === 'senv.project' ? 'project-1' : 'origin';
  }
  expect(engine.paths.every((path) => path.endsWith('/json'))).toBe(true);
});

test('reports an unavailable sample when the Docker stats request fails', async () => {
  const engine = new StatsDocker();
  engine.statsError = true;
  await expect(
    readOriginResourceSample({
      engine,
      instanceId: 'test',
      projectId: 'project-1',
      deploymentId: 'deployment-1',
    }),
  ).resolves.toMatchObject({ status: 'unavailable', reason: 'stats-unavailable' });
});
