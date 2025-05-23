import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { join } from 'path';

const DB_FILE_PATH = join(process.cwd(), 'data', 'sqlite.db');

const client = createClient({
  url: `file:${DB_FILE_PATH}`,
});

export const db = drizzle(client);
