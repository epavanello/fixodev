import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'file:data/sqlite.db',
  },
} satisfies Config;
