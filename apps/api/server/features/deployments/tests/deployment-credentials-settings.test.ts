import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import {
  deploymentInstanceDefaults,
  deploymentRegistryCredential,
  organization,
} from '../../../../../../drizzle/schema.ts';
import { api, db, projectId } from './deployments.test-support.ts';

test('credential updates retain secrets and reject empty creates or stale IDs', () => {
  expect(() =>
    api.saveRegistryCredential({
      projectId,
      name: 'private',
      registry: 'registry.example.com',
      username: 'builder',
      secret: '',
    }),
  ).toThrow();
  expect(db.select().from(deploymentRegistryCredential).all()).toHaveLength(0);

  const saved = api.saveRegistryCredential({
    projectId,
    name: 'private',
    registry: 'registry.example.com',
    username: 'builder',
    secret: 'first-secret',
  })[0]!;
  const ciphertext = db
    .select()
    .from(deploymentRegistryCredential)
    .where(eq(deploymentRegistryCredential.id, saved.id))
    .get()!.ciphertext;
  api.saveRegistryCredential({
    projectId,
    id: saved.id,
    name: 'renamed',
    registry: 'registry.example.com',
    username: 'builder',
    secret: '',
  });
  expect(
    db
      .select()
      .from(deploymentRegistryCredential)
      .where(eq(deploymentRegistryCredential.id, saved.id))
      .get(),
  ).toMatchObject({ name: 'renamed', ciphertext });

  expect(() =>
    api.saveRegistryCredential({
      projectId,
      id: 'missing-credential',
      name: 'stale',
      registry: 'registry.example.com',
      username: 'builder',
      secret: 'new-secret',
    }),
  ).toThrow();
  db.insert(organization)
    .values({ id: 'credential-other-project', name: 'Other', slug: 'credential-other' })
    .run();
  db.insert(deploymentRegistryCredential)
    .values({
      id: 'foreign-credential',
      projectId: 'credential-other-project',
      name: 'foreign',
      registry: 'registry.example.com',
      username: 'builder',
      ciphertext,
    })
    .run();
  expect(() =>
    api.saveRegistryCredential({
      projectId,
      id: 'foreign-credential',
      name: 'foreign edit',
      registry: 'registry.example.com',
      username: 'builder',
      secret: 'new-secret',
    }),
  ).toThrow();
  expect(db.select().from(deploymentRegistryCredential).all()).toHaveLength(2);
});

test('instance defaults read and update canonical row 1 only', () => {
  db.delete(deploymentInstanceDefaults).run();
  db.insert(deploymentInstanceDefaults)
    .values([
      { id: 1, proxyCpus: '0.3' },
      { id: 2, proxyCpus: '7' },
    ])
    .run();
  expect(api.getInstanceDeploymentDefaults().proxyCpus).toBe('0.3');
  api.updateInstanceDeploymentDefaults({
    ...api.getInstanceDeploymentDefaults(),
    proxyCpus: '0.5',
  });
  expect(
    db.select().from(deploymentInstanceDefaults).where(eq(deploymentInstanceDefaults.id, 1)).get()
      ?.proxyCpus,
  ).toBe('0.5');
  expect(
    db.select().from(deploymentInstanceDefaults).where(eq(deploymentInstanceDefaults.id, 2)).get()
      ?.proxyCpus,
  ).toBe('7');
});

test('instance defaults initialize ID 1 when only a stray row exists', () => {
  db.delete(deploymentInstanceDefaults).run();
  db.insert(deploymentInstanceDefaults).values({ id: 2, proxyCpus: '7' }).run();
  expect(api.getInstanceDeploymentDefaults().proxyCpus).not.toBe('7');
  const defaults = api.getInstanceDeploymentDefaults();
  api.updateInstanceDeploymentDefaults({ ...defaults, proxyCpus: '0.4' });
  expect(
    db.select().from(deploymentInstanceDefaults).where(eq(deploymentInstanceDefaults.id, 1)).get()
      ?.proxyCpus,
  ).toBe('0.4');
  expect(
    db.select().from(deploymentInstanceDefaults).where(eq(deploymentInstanceDefaults.id, 2)).get()
      ?.proxyCpus,
  ).toBe('7');
});
