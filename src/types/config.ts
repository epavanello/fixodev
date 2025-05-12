import { Runtime } from '../docker';

export interface BotConfig {
  runtime: Runtime;
  branches: {
    target: string;
  };
  scripts: {
    lint?: string;
    test?: string;
    format?: string;
  };
  linter?: {
    name: string;
    config?: Record<string, unknown>;
  };
  testFramework?: {
    name: string;
    config?: Record<string, unknown>;
  };
  projectType?: string;
  dependencies?: string[];
}
