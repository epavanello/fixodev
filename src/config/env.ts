import { config } from 'dotenv';

// Load environment variables from .env file
config();

export interface EnvConfig {
  // GitHub App
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;

  // OpenAI
  OPENAI_API_KEY: string;

  // Application
  PORT: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
  MAX_CONCURRENT_JOBS: string;

  // Docker
  DOCKER_RUNTIME_PREFIX: string | undefined;
}

export const envConfig: EnvConfig = {
  // GitHub App
  GITHUB_APP_ID: process.env.GITHUB_APP_ID || '',
  GITHUB_PRIVATE_KEY: process.env.GITHUB_PRIVATE_KEY || '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // Application
  PORT: process.env.PORT || '3000',
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  MAX_CONCURRENT_JOBS: process.env.MAX_CONCURRENT_JOBS || '2',

  // Docker
  DOCKER_RUNTIME_PREFIX: process.env.DOCKER_RUNTIME_PREFIX,
};
