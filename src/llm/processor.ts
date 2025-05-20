import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { RepoAgent, AgentOptions } from './agent';
import { BotConfig } from '../types/config';
import { CoreMessage, LanguageModelV1 } from 'ai';
import { coderModel } from './client';
import { ToolParameters, WrappedTool } from './tools/types';
import { readonlyTools, searchTools, writableTools } from './tools';
import { generateSystemPrompt, generateTestPrompt } from './prompts/prompts';

export interface CodeContext {
  filePath?: string;
  language?: string;
  dependencies?: string[];
  linter?: { name: string; config?: Record<string, unknown> };
  testFramework?: { name: string; config?: Record<string, unknown> };
  projectType?: string;
  command?: string;
  conversationalLogging?: boolean;
  history?: CoreMessage[];
  model?: LanguageModelV1;
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
  model: context.model || coderModel,
  maxIterations: context.maxIterations || 25,
  conversationalLogging: context.conversationalLogging,
  history: context.history,
});

/**
 * Create and configure an Agent for source modification (read and write operations)
 */
export const createSourceModifierAgent = async (
  context: CodeContext,
  repositoryPath?: string,
  agentOptionOverrides?: Partial<AgentOptions>,
) => {
  const defaultSystemMessage = await generateSystemPrompt({
    repositoryContext: repositoryPath ?? '',
  });

  const agent = new RepoAgent({
    ...getBaseAgentConfig(context, repositoryPath),
    systemMessage: agentOptionOverrides?.systemMessage || defaultSystemMessage,
    ...agentOptionOverrides,
  });

  [...readonlyTools, ...writableTools, ...searchTools].forEach(tool => agent.registerTool(tool));

  return agent;
};

/**
 * Processes a user's code modification request using a comprehensive agent.
 * The agent will analyze the request, search for relevant files, read them,
 * and apply necessary changes across the codebase.
 * Returns true if the agent indicated successful completion and potentially made changes.
 */
export const processCodeModificationRequest = async <PARAMS extends ToolParameters, OUTPUT>(
  modificationRequest: string,
  repositoryPath: string,
  botConfig: BotConfig,
  conversationalLogging: boolean = false,
  outputTool?: WrappedTool<PARAMS, OUTPUT> | undefined,
): Promise<OUTPUT | undefined> => {
  try {
    const context: CodeContext = {
      command: modificationRequest,
      language: botConfig.runtime,
      botConfig,
      conversationalLogging,
      maxIterations: 50,
    };

    const agent = await createSourceModifierAgent(context, repositoryPath);

    const result = await agent.run(modificationRequest, {
      outputTool: outputTool,
      toolChoice: 'required',
    });

    if (result) {
      logger.debug(
        { result, modificationRequest, repositoryPath },
        'Code modification request processing completed by agent.',
      );
      return result;
    } else {
      logger.warn(
        { modificationRequest, repositoryPath },
        'Agent did not return a result from taskCompletion tool for modification request (e.g. max iterations reached without completion signal).',
      );
      return undefined;
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
