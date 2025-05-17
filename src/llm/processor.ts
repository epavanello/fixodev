import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { Agent, AgentOptions } from './agent';
import { Message } from './agent/context';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirectoryTool,
  createFileExistsTool,
} from './tools/file';
import { createGrepTool, createFindFilesTool } from './tools/search';
import { generateCodeAssistantSystemPrompt } from './prompts/system';
import { createTaskCompletionTool } from './tools/registry';
import { BotConfig } from '../types/config';

export interface CodeContext {
  filePath?: string;
  language?: string;
  dependencies?: string[];
  linter?: { name: string; config?: Record<string, unknown> };
  testFramework?: { name: string; config?: Record<string, unknown> };
  projectType?: string;
  command?: string;
  conversationalLogging?: boolean;
  history?: Message[];
  model?: string;
  maxIterations?: number;
  botConfig?: BotConfig;
}

/**
 * Common agent options from context, excluding systemMessage which is factory-specific.
 */
const getBaseAgentConfig = (
  context: CodeContext,
  repositoryPath?: string,
): Omit<AgentOptions, 'systemMessage'> => ({
  basePath: repositoryPath || '.',
  model: context.model || 'gpt-4o',
  maxIterations: context.maxIterations || 25,
  conversationalLogging: context.conversationalLogging,
  history: context.history,
});

/**
 * Create and configure an Agent for source modification (read and write operations)
 */
export const createSourceModifierAgent = (
  context: CodeContext,
  repositoryPath?: string,
  agentOptionOverrides?: Partial<AgentOptions>,
) => {
  const defaultSystemMessage = generateCodeAssistantSystemPrompt({
    languages: [context.language || context.botConfig?.runtime || 'unknown'],
  });

  const agent = new Agent({
    ...getBaseAgentConfig(context, repositoryPath),
    systemMessage: agentOptionOverrides?.systemMessage || defaultSystemMessage,
    ...agentOptionOverrides,
  });

  // Register file system tools (including write)
  const effectiveRepoPath = repositoryPath || '.';
  agent.registerTool(createReadFileTool(effectiveRepoPath));
  agent.registerTool(createWriteFileTool(effectiveRepoPath));
  agent.registerTool(createListDirectoryTool(effectiveRepoPath));
  agent.registerTool(createFileExistsTool(effectiveRepoPath));

  // Register search tools
  agent.registerTool(createGrepTool(effectiveRepoPath));
  agent.registerTool(createFindFilesTool(effectiveRepoPath));

  return agent;
};

/**
 * Processes a user's code modification request using a comprehensive agent.
 * The agent will analyze the request, search for relevant files, read them,
 * and apply necessary changes across the codebase.
 * Returns true if the agent indicated successful completion and potentially made changes.
 */
export const processCodeModificationRequest = async (
  modificationRequest: string,
  repositoryPath: string,
  botConfig: BotConfig,
  conversationalLogging: boolean = process.env.NODE_ENV === 'development',
): Promise<boolean> => {
  try {
    const context: CodeContext = {
      command: modificationRequest,
      language: botConfig.runtime,
      botConfig,
      conversationalLogging,
      maxIterations: 25,
    };

    const agent = createSourceModifierAgent(context, repositoryPath);

    let outputTool: ReturnType<typeof createTaskCompletionTool> | undefined;
    if (!conversationalLogging) {
      // The outputTool for the agent's run method is now taskCompletion.
      // The agent will call this tool to signal it has finished.
      outputTool = createTaskCompletionTool();
    }

    const result = await agent.run(modificationRequest, {
      outputTool: outputTool,
      toolChoice: 'required',
    });

    if (result) {
      logger.debug(
        { result, modificationRequest, repositoryPath },
        'Code modification request processing completed by agent.',
      );
      return result.objectiveAchieved;
    } else {
      logger.warn(
        { modificationRequest, repositoryPath },
        'Agent did not return a result from taskCompletion tool for modification request (e.g. max iterations reached without completion signal).',
      );
      return false;
    }
  } catch (error) {
    logger.error(
      { modificationRequest, repositoryPath, error },
      'Failed to process code modification request',
    );
    throw new GitHubError(
      `Failed to process code modification request: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
