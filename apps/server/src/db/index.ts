import { drizzle } from 'drizzle-orm/libsql';
import { envConfig } from '../config/env';
import * as schema from './schema';

export const db = drizzle({
  schema,
  connection: {
    url: envConfig.DATABASE_URL,
    authToken: envConfig.DATABASE_AUTH_TOKEN,
  },
});
