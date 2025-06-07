import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';
import path from 'path';
import { z } from 'zod';
config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DATABASE_AUTH_TOKEN: z.string(),
  DATABASE_DIALECT: z.union([z.literal('turso'), z.literal('sqlite')]).default('turso'),
});

let envConfig: z.infer<typeof envSchema>;
try {
  envConfig = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    throw new Error(error.message);
  }
  throw error;
}
export default {
  schema: './src/db/schema.ts',
  dialect: envConfig.DATABASE_DIALECT,
  dbCredentials: {
    url: envConfig.DATABASE_URL,
    authToken: envConfig.DATABASE_AUTH_TOKEN,
  },
} satisfies Config;
