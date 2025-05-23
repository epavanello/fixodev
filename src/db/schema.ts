import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const jobsTable = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }),
    status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    logs: text('logs', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
  },
  table => [uniqueIndex('status_idx').on(table.status)],
);

export type JobInsert = typeof jobsTable.$inferInsert;
export type JobSelect = typeof jobsTable.$inferSelect;
