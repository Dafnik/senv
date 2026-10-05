import { sql } from 'drizzle-orm';
import { integer, text } from 'drizzle-orm/sqlite-core';

export const createdAt = () =>
  integer('createdAt', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);
export const updatedAt = () =>
  integer('updatedAt', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`)
    .$onUpdate(() => new Date());

export const jsonText = <T>(name: string) => text(name, { mode: 'json' }).$type<T>().notNull();
