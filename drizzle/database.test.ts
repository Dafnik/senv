import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { createDatabase } from './database';
import { account, automationToken, organization, session, user, verification } from './schema';
import { sqlitePath } from './sqlite-path';

const databases: ReturnType<typeof createDatabase>[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.$client.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function open(url: string) {
  const db = createDatabase(url);
  databases.push(db);
  migrate(db, { migrationsFolder: 'drizzle/migrations' });
  return db;
}

describe('SQLite migrations', () => {
  test('optional token expiry preserves existing tokens and their constraints during upgrade', () => {
    const directory = mkdtempSync(join(tmpdir(), 'senv-token-migration-'));
    directories.push(directory);
    mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 3);
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(`drizzle/migrations/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    const db = createDatabase(':memory:');
    databases.push(db);
    migrate(db, { migrationsFolder: directory });
    db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
    db.insert(organization).values({ id: 'project', name: 'Project', slug: 'project' }).run();
    const token = {
      id: 'finite',
      tokenHash: 'finite-hash',
      prefix: 'finite-prefix',
      name: 'Existing CI',
      userId: 'owner',
      projectId: 'project',
      permission: 'read' as const,
      expiresAt: new Date('2027-01-01'),
      lastUsedAt: new Date('2026-10-01'),
    };
    db.insert(automationToken).values(token).run();
    const before = db.select().from(automationToken).get();
    migrate(db, { migrationsFolder: 'drizzle/migrations' });
    expect(db.select().from(automationToken).get()).toEqual(before);
    db.insert(automationToken)
      .values({ ...token, id: 'infinite', tokenHash: 'infinite-hash', expiresAt: null })
      .run();
    expect(
      db.select().from(automationToken).where(eq(automationToken.id, 'infinite')).get()!.expiresAt,
    ).toBeNull();
    expect(() =>
      db
        .insert(automationToken)
        .values({ ...token, id: 'duplicate' })
        .run(),
    ).toThrow();
    expect(() =>
      db
        .insert(automationToken)
        .values({ ...token, id: 'orphan', tokenHash: 'orphan-hash', userId: 'missing' })
        .run(),
    ).toThrow();
    db.delete(user).where(eq(user.id, 'owner')).run();
    expect(db.select().from(automationToken).all()).toEqual([]);
  });

  test('can run twice and preserve data across connections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'senv-sqlite-'));
    directories.push(directory);
    const url = `file:${join(directory, 'nested', 'senv.sqlite')}`;
    const db = open(url);
    db.insert(user).values({ id: 'user-1', name: 'Test', email: 'test@example.com' }).run();
    migrate(db, { migrationsFolder: 'drizzle/migrations' });
    const reopened = open(url);
    const saved = reopened.select().from(user).get()!;
    expect(saved.email).toBe('test@example.com');
    expect(saved.emailVerified).toBe(false);
    expect(saved.banned).toBe(false);
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBeInstanceOf(Date);
    expect(reopened.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  test('enforces uniqueness and cascades account and session deletion', () => {
    const db = open(':memory:');
    db.insert(user).values({ id: 'user-1', name: 'Test', email: 'test@example.com' }).run();
    expect(() =>
      db.insert(user).values({ id: 'user-2', name: 'Duplicate', email: 'test@example.com' }).run(),
    ).toThrow();
    db.insert(account)
      .values({ id: 'account-1', accountId: 'user-1', providerId: 'credential', userId: 'user-1' })
      .run();
    db.insert(session)
      .values({
        id: 'session-1',
        token: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .run();
    expect(() =>
      db
        .insert(session)
        .values({ id: 'orphan', token: 'token-2', userId: 'missing', expiresAt: new Date() })
        .run(),
    ).toThrow();
    db.delete(user).where(eq(user.id, 'user-1')).run();
    expect(db.select().from(account).all()).toEqual([]);
    expect(db.select().from(session).all()).toEqual([]);
  });

  test('round-trips verification expiry with millisecond precision', () => {
    const db = open(':memory:');
    const expiresAt = new Date('2026-10-02T12:34:56.789Z');
    db.insert(verification)
      .values({ id: 'verification-1', identifier: 'test@example.com', value: 'code', expiresAt })
      .run();
    expect(db.select().from(verification).get()!.expiresAt).toEqual(expiresAt);
  });

  test('rejects non-SQLite and empty database URLs', () => {
    expect(() => sqlitePath('https://example.com/db')).toThrow('DATABASE_URL');
    expect(() => sqlitePath('file:')).toThrow('DATABASE_URL');
  });
});
