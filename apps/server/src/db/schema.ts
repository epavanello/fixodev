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

export const userPlansTable = sqliteTable('user_plans', {
  userId: text('user_id').primaryKey(),
  planType: text('plan_type', { enum: ['free', 'paid'] })
    .notNull()
    .default('free'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const jobExecutionsTable = sqliteTable(
  'job_executions',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    triggeredBy: text('triggered_by').notNull(),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    jobType: text('job_type').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  table => [
    uniqueIndex('triggered_by_idx').on(table.triggeredBy),
    uniqueIndex('repo_owner_idx').on(table.repoOwner),
    uniqueIndex('created_at_idx').on(table.createdAt),
  ],
);

export type JobInsert = typeof jobsTable.$inferInsert;
export type JobSelect = typeof jobsTable.$inferSelect;
export type UserPlanInsert = typeof userPlansTable.$inferInsert;
export type UserPlanSelect = typeof userPlansTable.$inferSelect;
export type JobExecutionInsert = typeof jobExecutionsTable.$inferInsert;
export type JobExecutionSelect = typeof jobExecutionsTable.$inferSelect;
