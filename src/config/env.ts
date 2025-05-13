import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
config();

const envSchema = z.object({
  // GitHub App
  GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required'),
  GITHUB_PRIVATE_KEY: z.string().min(1, 'GITHUB_PRIVATE_KEY is required'),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // Application
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MAX_CONCURRENT_JOBS: z
    .string()
    .transform(val => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 1) {
        throw new Error('MAX_CONCURRENT_JOBS must be a positive number');
      }
      return num.toString();
    })
    .default('2'),
  CLEANUP_REPOSITORIES: z
    .string()
    .transform(val => val === 'true')
    .default('true'),

  // Docker
  DOCKER_RUNTIME_PREFIX: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

function formatValidationError(error: z.ZodError): string {
  const issues = error.issues
    .map(issue => {
      const path = issue.path.join('.');
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');

  return `Environment validation failed:\n${issues}\n\nPlease check your .env file and ensure all required variables are set correctly.`;
}

let envConfig: EnvConfig;

try {
  envConfig = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    throw new Error(formatValidationError(error));
  }
  throw error;
}

export { envConfig };
