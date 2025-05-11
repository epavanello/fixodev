import pino from 'pino';
import { envConfig } from './env';

export const logger = pino({
  level: envConfig.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});
