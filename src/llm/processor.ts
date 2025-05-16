import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { Agent, AgentOptions } from './agent';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirectoryTool,
  createFileExistsTool,
} from './tools/file';
import { createGrepTool, createFindFilesTool } from './tools/search';
import {
  generateCodeAssistantSystemPrompt,
  generateFixCodeSystemPrompt,
  generateFixLintingSystemPrompt,
  generateFixTestsSystemPrompt,
} from './prompts/system';
import { generateFixPrompt, generateLintFixPrompt, generateTestFixPrompt } from './prompts/fix';
import { createRepositoryAnalysisTool, createUpdatedSourceCodeTool } from './tools/registry';
import { Message } from './agent/context';

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
  maxIterations: context.maxIterations || 15,
  conversationalLogging: context.conversationalLogging,
  history: context.history,
});

/**
 * Create and configure a unified Agent for analysis and modification (read and write operations)
 */
export const createUnifiedAgent = (
  context: CodeContext,
  repositoryPath: string,
  agentOptionOverrides?: Partial<AgentOptions>,
) => {
  const systemMessage =
    agentOptionOverrides?.systemMessage ||
    generateCodeAssistantSystemPrompt({
      taskType: 'analyze-and-fix',
      languages: [context.language || 'unknown'],
    });

  const agent = new Agent({
    ...getBaseAgentConfig(context, repositoryPath),
    systemMessage,
    ...agentOptionOverrides,
  });

  const effectiveRepoPath = repositoryPath || '.';
  // Register read and write file system tools
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
 * Analyze and Fix code using LLM
 */
export const analyzeAndFixCode = async (context: CodeContext, repositoryPath: string, code: string, issue?: string) => {
  try {
    logger.info({ command: context.command, repositoryPath }, 'Analyzing and potentially fixing repository');

    // Create unified agent
    const agent = createUnifiedAgent(context, repositoryPath);

    // Prepare prompt
    let prompt = `
      I need you to analyze this repository and suggest changes based on the following request:
      "${context.command}"
      
      First, explore the repository structure to understand what we're working with.
      Then, identify the files that need to be modified to implement the requested changes.
    `;
    if (issue) {
      prompt += `
      After analyzing, proceed to fix the issue: "${issue}"
      
      Code to be analyzed:
      ${code}
      `;
    }

    // Run the agent with the command
    const response = await agent.run(prompt, {
      outputTool: createUpdatedSourceCodeTool(),
    });

    if (!response) {
      throw new Error('No response from agent');
    }

    return {
      analysis: response,
      history: agent.getContext().getMessages(),
    };
  } catch (error) {
    logger.error({ command: context.command, error }, 'Failed to analyze and/or fix repository');
    throw new GitHubError(
      `Failed to process repository: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};