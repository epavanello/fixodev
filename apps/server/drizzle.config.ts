import type { Config } from 'drizzle-kit';
import { envConfig } from './src/config/env';

export default {
  schema: './src/db/schema.ts',
  dialect: 'turso',
  dbCredentials: {
    url: envConfig.DATABASE_URL,
    authToken: envConfig.DATABASE_AUTH_TOKEN,
  },
} satisfies Config;
