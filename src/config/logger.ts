import pino from 'pino';
import { envConfig } from './env';

export const loggerConfig: pino.LoggerOptions = {
  level: envConfig.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
};

export const logger = pino(loggerConfig);
