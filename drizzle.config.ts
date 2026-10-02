import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { sqlitePath } from './drizzle/sqlite-path';

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: sqlitePath(process.env['DATABASE_URL'] ?? 'file:./data/senv.sqlite'),
  },
});
