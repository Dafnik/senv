import { createDatabase } from '../../../../drizzle/database';
import env from './env';

const globalForDatabase = globalThis as unknown as {
  database?: ReturnType<typeof createDatabase>;
};

export const db = globalForDatabase.database ?? createDatabase(env.DATABASE_URL);
globalForDatabase.database = db;
