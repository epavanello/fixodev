import { readFile } from 'fs/promises';
import { join } from 'path';
import { parse } from 'yaml';
import { BotConfig } from '../types/config';
import { Runtime } from '../docker';

const CONFIG_FILE = '.reposister.yml';

export const loadBotConfig = async (repoPath: string): Promise<BotConfig> => {
  try {
    const configPath = join(repoPath, CONFIG_FILE);
    const configContent = await readFile(configPath, 'utf8');
    const config = parse(configContent) as Partial<BotConfig>;

    // Validate and set defaults
    return {
      runtime: (config.runtime || 'node') as Runtime,
      branches: {
        target: config.branches?.target || 'main',
      },
      scripts: {
        lint: config.scripts?.lint,
        test: config.scripts?.test,
        format: config.scripts?.format,
      },
      linter: config.linter,
      testFramework: config.testFramework,
      projectType: config.projectType,
      dependencies: config.dependencies,
    };
  } catch (error) {
    // Return default config if file doesn't exist
    return {
      runtime: 'node',
      branches: {
        target: 'main',
      },
      scripts: {},
    };
  }
};
