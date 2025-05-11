import { envConfig } from './env';

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  maxConcurrentJobs: number;
}

export const appConfig: AppConfig = {
  port: parseInt(envConfig.PORT, 10) || 3000,
  host: '0.0.0.0',
  nodeEnv: envConfig.NODE_ENV || 'development',
  maxConcurrentJobs: parseInt(envConfig.MAX_CONCURRENT_JOBS, 10) || 2,
};
