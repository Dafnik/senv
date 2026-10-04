import { and, eq, like } from 'drizzle-orm';
import { verification } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';
export function findVerification(identifier: string, database: Pick<QueryHandle, 'select'> = db) {
  return database.select().from(verification).where(eq(verification.identifier, identifier)).get();
}
export function insertVerification(
  database: QueryHandle,
  values: typeof verification.$inferInsert,
) {
  return database.insert(verification).values(values).run();
}
export function deleteVerificationByIdentifier(identifier: string) {
  return db.delete(verification).where(eq(verification.identifier, identifier)).run();
}
export function deleteVerificationByValue(database: QueryHandle, value: string) {
  return database.delete(verification).where(eq(verification.value, value)).run();
}
export function deletePasswordResetVerifications(database: QueryHandle, value: string) {
  return database
    .delete(verification)
    .where(and(eq(verification.value, value), like(verification.identifier, 'account-password:%')))
    .run();
}
