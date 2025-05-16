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
 * Create and configure an Agent for information analysis (read-only operations)
 */
export const createInformationAnalyzerAgent = (
  context: CodeContext,
  repositoryPath: string,
  agentOptionOverrides?: Partial<AgentOptions>,
) => {
  const systemMessage =
    agentOptionOverrides?.systemMessage ||
    generateCodeAssistantSystemPrompt({
      taskType: 'analyze',
      languages: [context.language || 'unknown'],
    });

  const agent = new Agent({
    ...getBaseAgentConfig(context, repositoryPath),
    systemMessage,
    ...agentOptionOverrides,
  });

  // Register read-only file system tools
  agent.registerTool(createReadFileTool(repositoryPath));
  agent.registerTool(createListDirectoryTool(repositoryPath));
  agent.registerTool(createFileExistsTool(repositoryPath));

  // Register search tools
  agent.registerTool(createGrepTool(repositoryPath));
  agent.registerTool(createFindFilesTool(repositoryPath));

  return agent;
};

/**
 * Create and configure an Agent for source modification (read and write operations)
 */
export const createSourceModifierAgent = (
  context: CodeContext,
  repositoryPath?: string,
  agentOptionOverrides?: Partial<AgentOptions>,
) => {
  const defaultSystemMessage = generateCodeAssistantSystemPrompt({
    taskType: 'feature',
    languages: [context.language || 'unknown'],
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
 * Analyze code using LLM
 */
export const analyzeCode = async (context: CodeContext, repositoryPath: string) => {
  try {
    logger.info({ command: context.command, repositoryPath }, 'Analyzing repository for changes');

    // Create information analyzer agent
    const agent = createInformationAnalyzerAgent(context, repositoryPath);

    // Run the agent with the command
    const response = await agent.run(
      `
      I need you to analyze this repository and suggest changes based on the following request:
      "${context.command}"
      
      First, explore the repository structure to understand what we're working with.
      Then, identify the files that need to be modified to implement the requested changes.
      
      Use the repositoryAnalysis tool to return your analysis results.
    `,
      {
        outputTool: createRepositoryAnalysisTool(),
      },
    );

    if (!response) {
      throw new Error('No response from agent');
    }

    return {
      analysis: response,
      history: agent.getContext().getMessages(),
    };
  } catch (error) {
    logger.error({ command: context.command, error }, 'Failed to analyze repository');
    throw new GitHubError(
      `Failed to analyze repository: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Fix code issues using LLM
 */
export const fixCode = async (
  code: string,
  issue: string,
  context: CodeContext,
  repositoryPath?: string,
): Promise<string> => {
  try {
    logger.info({ filePath: context.filePath, repositoryPath }, 'Fixing code');
    const outputTool = createUpdatedSourceCodeTool();
    const systemMessage = generateFixCodeSystemPrompt(
      outputTool.name,
      context.filePath,
      context.language,
      issue,
    );
    const agent = createSourceModifierAgent(context, repositoryPath, { systemMessage });

    const response = await agent.run(generateFixPrompt(code, issue, context), {
      outputTool: outputTool,
      toolChoice: 'required',
    });

    if (!response) {
      throw new Error('No response from agent for fixCode');
    }

    logger.info({ filePath: context.filePath, repositoryPath }, 'Code fix completed.');
    return response.code;
  } catch (error) {
    logger.error({ filePath: context.filePath, error, repositoryPath }, 'Failed to fix code');
    throw new GitHubError(
      `Failed to fix code: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Fix linting issues using LLM
 */
export const fixLinting = async (
  code: string,
  lintErrors: string[],
  context: CodeContext,
  repositoryPath?: string,
): Promise<string> => {
  try {
    logger.info({ filePath: context.filePath, repositoryPath }, 'Fixing linting issues');
    const outputTool = createUpdatedSourceCodeTool();
    const systemMessage = generateFixLintingSystemPrompt(
      outputTool.name,
      context.filePath,
      context.language,
      context.linter?.name,
    );

    const agent = createSourceModifierAgent(context, repositoryPath, { systemMessage });

    const prompt = generateLintFixPrompt(code, lintErrors, context);

    const response = await agent.run(prompt, {
      outputTool: outputTool,
      toolChoice: { type: 'function', function: { name: outputTool.name } },
    });

    if (!response) {
      throw new Error('No response from agent for fixLinting');
    }

    logger.info({ filePath: context.filePath, repositoryPath }, 'Linting fix completed.');
    return response.code;
  } catch (error) {
    logger.error(
      { filePath: context.filePath, error, repositoryPath },
      'Failed to fix linting issues',
    );
    throw new GitHubError(
      `Failed to fix linting issues: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Fix test failures using LLM
 */
export const fixTests = async (
  code: string,
  testOutput: string,
  context: CodeContext,
  repositoryPath?: string,
): Promise<string> => {
  try {
    logger.info({ filePath: context.filePath, repositoryPath }, 'Fixing test failures');
    const outputTool = createUpdatedSourceCodeTool();
    const systemMessage = generateFixTestsSystemPrompt(
      outputTool.name,
      context.filePath,
      context.language,
      context.testFramework?.name,
    );

    const agent = createSourceModifierAgent(context, repositoryPath, { systemMessage });

    const prompt = generateTestFixPrompt(code, testOutput, context);

    const response = await agent.run(prompt, {
      outputTool: outputTool,
      toolChoice: { type: 'function', function: { name: outputTool.name } },
    });

    if (!response) {
      throw new Error('No response from agent for fixTests');
    }

    logger.info({ filePath: context.filePath, repositoryPath }, 'Test fix completed.');
    return response.code;
  } catch (error) {
    logger.error(
      { filePath: context.filePath, error, repositoryPath },
      'Failed to fix test failures',
    );
    throw new GitHubError(
      `Failed to fix test failures: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
