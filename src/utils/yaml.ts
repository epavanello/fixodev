import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { logger } from '../config/logger';

/**
 * Bot configuration structure
 */
export interface BotConfig {
  runtime: string;
  scripts: {
    lint?: string;
    test?: string;
    format?: string;
    [key: string]: string | undefined;
  };
  autofix: boolean;
  branches: {
    autofix: boolean;
    target: string;
  };
}

/**
 * Default bot configuration
 */
export const defaultBotConfig: BotConfig = {
  runtime: 'node:20',
  scripts: {
    lint: 'npm run lint',
    test: 'npm run test',
    format: 'npm run format',
  },
  autofix: true,
  branches: {
    autofix: true,
    target: 'main',
  },
};

/**
 * Parse and load bot configuration from a repository
 */
export const loadBotConfig = async (repoPath: string): Promise<BotConfig> => {
  try {
    const configPath = join(repoPath, '.bot-config.yml');

    // Check if config file exists
    if (!existsSync(configPath)) {
      logger.info('No bot configuration found, using defaults');
      return defaultBotConfig;
    }

    // Read and parse YAML file
    const configFile = await readFile(configPath, 'utf8');
    const config = load(configFile) as Partial<BotConfig>;

    // Merge with defaults
    return {
      ...defaultBotConfig,
      ...config,
      scripts: {
        ...defaultBotConfig.scripts,
        ...(config.scripts || {}),
      },
      branches: {
        ...defaultBotConfig.branches,
        ...(config.branches || {}),
      },
    };
  } catch (error) {
    logger.error(error, 'Failed to load bot configuration');
    return defaultBotConfig;
  }
};
