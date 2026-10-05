import { closeShells } from '../../deployments/services/shell-registry';
import { and, count, eq, sql } from 'drizzle-orm';
import {
  account,
  session,
  user,
  automationToken,
  deviceCode,
} from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';
export function findAccount(userId: string, database: Pick<QueryHandle, 'select'> = db) {
  return database.select().from(user).where(eq(user.id, userId)).get();
}
export function findCredential(userId: string, database: Pick<QueryHandle, 'select'> = db) {
  return database
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .get();
}
export function insertAccount(database: QueryHandle, values: typeof user.$inferInsert) {
  return database.insert(user).values(values).run();
}
export function insertCredential(database: QueryHandle, values: typeof account.$inferInsert) {
  return database.insert(account).values(values).run();
}
export function updateCredentialPassword(
  database: QueryHandle,
  accountId: string,
  password: string,
) {
  return database.update(account).set({ password }).where(eq(account.id, accountId)).run();
}
export function verifyAccountEmail(database: QueryHandle, userId: string) {
  return database.update(user).set({ emailVerified: true }).where(eq(user.id, userId)).run();
}
export function deleteAccountSessions(database: QueryHandle, userId: string) {
  void closeShells({ userId }, 'session_revoked');
  database.delete(automationToken).where(eq(automationToken.userId, userId)).run();
  database.delete(deviceCode).where(eq(deviceCode.userId, userId)).run();
  return database.delete(session).where(eq(session.userId, userId)).run();
}
export function findAccountByEmail(email: string) {
  return db.select().from(user).where(eq(user.email, email)).get();
}
export function findAccountEmailConflict(database: QueryHandle, email: string) {
  return database
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`)
    .get();
}
export function findInstanceAdmin(database: Pick<QueryHandle, 'select'> = db) {
  return database.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1).get();
}
export function findAccountSession(database: QueryHandle, sessionId: string) {
  return database.select().from(session).where(eq(session.id, sessionId)).get();
}
export function countInstanceAdmins(database: QueryHandle) {
  return database.select({ total: count() }).from(user).where(eq(user.role, 'admin')).get();
}
export function updateAccountRole(database: QueryHandle, userId: string, role: string) {
  void closeShells({ userId }, 'permission_lost');
  return database.update(user).set({ role }).where(eq(user.id, userId)).returning().get();
}
export function deleteAccount(database: QueryHandle, userId: string) {
  void closeShells({ userId }, 'session_revoked');
  return database.delete(user).where(eq(user.id, userId)).run();
}

export function findAccountForSignup(
  userId: string,
  email: string,
  database: Pick<QueryHandle, 'select'>,
) {
  return database
    .select()
    .from(user)
    .where(and(eq(user.id, userId), eq(user.email, email)))
    .get();
}
