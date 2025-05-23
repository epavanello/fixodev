import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { join } from 'path';
import * as schema from './schema';

const DB_FILE_PATH = join(process.cwd(), 'data', 'sqlite.db');

const client = createClient({
  url: `file:${DB_FILE_PATH}`,
});

export const db = drizzle(client, { schema });

export type DB = typeof db;
