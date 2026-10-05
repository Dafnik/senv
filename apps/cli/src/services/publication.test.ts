import { expect, test, vi } from 'vite-plus/test';
import { publish } from './publication.ts';
import type { ClientContext } from '../api/client.ts';
function context() {
  const mutate = vi.fn(async () => ({ id: 'deployment' }));
  const value = { client: { deployments: { publish: { mutate } } } } as unknown as ClientContext;
  return { value, mutate };
}
test('publication submits once, reports its identifier, and preserves source inputs', async () => {
  const { value, mutate } = context();
  const submit = vi.fn();
  expect(
    await publish(value, 'project', undefined, {
      image: 'nginx:alpine',
      port: 80,
      onSubmit: submit,
    }),
  ).toMatchObject({ id: 'deployment' });
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: 'project', image: 'nginx:alpine', kind: 'container' }),
  );
});
test('invalid source combinations and cancelled preparation cannot submit a publication', async () => {
  const { value, mutate } = context();
  await expect(
    publish(value, 'project', 'path', { image: 'nginx:alpine', port: 80 }),
  ).rejects.toMatchObject({ exitCode: 2 });
  await expect(
    publish(value, 'project', undefined, { reuse: 'id', kind: 'invalid' as 'static', port: 80 }),
  ).rejects.toMatchObject({ exitCode: 2 });
  await expect(
    publish(value, 'project', undefined, {
      image: 'nginx:alpine',
      port: 80,
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow();
  expect(mutate).not.toHaveBeenCalled();
});
test('lost mutation responses are propagated without retrying', async () => {
  const { value, mutate } = context();
  mutate.mockRejectedValueOnce(new Error('response lost'));
  await expect(publish(value, 'project', undefined, { image: 'app', port: 80 })).rejects.toThrow(
    'response lost',
  );
  expect(mutate).toHaveBeenCalledOnce();
});

test('retained sources preserve original kind and port unless explicitly overridden', async () => {
  const { value, mutate } = context();
  Object.assign(value.client.deployments, {
    detail: { query: vi.fn(async () => ({ kind: 'container', config: { port: 8080 } })) },
  });
  await publish(value, 'project', undefined, { reuse: 'retained' });
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'container', port: 8080, reuseDeploymentId: 'retained' }),
  );
  await publish(value, 'project', undefined, { reuse: 'retained', kind: 'static', port: 9000 });
  expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'static', port: 9000 }));
});
