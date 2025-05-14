import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { Agent } from './agent';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirectoryTool,
  createFileExistsTool,
} from './tools/file';
import { createGrepTool, createFindFilesTool } from './tools/search';
import { generateCodeAssistantSystemPrompt } from './prompts/system';
import { BotConfig } from '../types/config';
import {
  createRepositoryAnalysisTool,
  createFixCodeTool,
  createFixLintingTool,
  createFixTestsTool,
  FixedCode,
} from './tools/registry';
import { Message } from './agent/context';

export interface CodeContext {
  filePath?: string;
  language?: string;
  dependencies?: string[];
  linter?: BotConfig['linter'];
  testFramework?: BotConfig['testFramework'];
  projectType?: string;
  command?: string;
  repositoryPath?: string;
  conversationalLogging?: boolean;
  history?: Message[];
}

/**
 * Create and configure an Agent for a repository
 */
export const createRepositoryAgent = (repositoryPath: string, context: CodeContext) => {
  // Create the agent
  const agent = new Agent({
    basePath: repositoryPath,
    model: 'gpt-4o',
    systemMessage: generateCodeAssistantSystemPrompt({
      taskType: 'feature',
      languages: [context.language || 'unknown'],
    }),
    maxIterations: 15,
    conversationalLogging: context.conversationalLogging,
    history: context.history,
  });

  // Register file system tools
  agent.registerTool(createReadFileTool(repositoryPath));
  agent.registerTool(createWriteFileTool(repositoryPath));
  agent.registerTool(createListDirectoryTool(repositoryPath));
  agent.registerTool(createFileExistsTool(repositoryPath));

  // Register search tools
  agent.registerTool(createGrepTool(repositoryPath));
  agent.registerTool(createFindFilesTool(repositoryPath));

  return agent;
};

/**
 * Analyze code using LLM
 */
export const analyzeCode = async (context: CodeContext) => {
  try {
    logger.info({ command: context.command }, 'Analyzing repository for changes');

    if (!context.repositoryPath) {
      throw new Error('Repository path is required for analysis');
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

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

    // The response will be the result from the repositoryAnalysis tool
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
): Promise<string> => {
  try {
    logger.info({ filePath: context.filePath }, 'Fixing code');

    if (!context.repositoryPath) {
      // Standalone mode: Use a minimal agent with a forced output tool
      const fixCodeTool = createFixCodeTool();
      const prompt = `Fix the following issue in the code:
${issue}

File: ${context.filePath || 'unknown'}
Language: ${context.language || 'unknown'}
Dependencies: ${context.dependencies?.join(', ') || 'none'}

Code:
\`\`\`
${code}
\`\`\`

Please provide only the corrected code with no explanations. The code should be complete and ready to use.

You MUST use the "${fixCodeTool.name}" tool to return the corrected code. Do not provide explanations outside of the tool.`;

      // Create a minimal agent for this specific task
      const agent = new Agent({
        basePath: '.', // Assuming no complex file ops for this standalone mode
        model: 'gpt-4o-mini', // Or a model from context if appropriate
        systemMessage: `You are a professional developer. Your task is to fix the provided code snippet. You MUST use the tool named "${fixCodeTool.name}" to return the corrected code. Do not provide explanations outside of the tool.`,
        maxIterations: 3,
      });

      // Run the agent with the issue and code
      const response = await agent.run(prompt, {
        outputTool: fixCodeTool,
      });

      if (!response) {
        throw new Error('No response from agent for fixCode');
      }

      logger.info({ filePath: context.filePath }, 'Code fix completed via tool (standalone agent)');
      return response.code;
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

    // Run the agent with the issue and code
    const response = await agent.run(
      `
      I need you to fix an issue in the following code:
      
      File: ${context.filePath || 'unknown'}
      Issue: ${issue}
      
      Here is the current code:
      \`\`\`
      ${code}
      \`\`\`
      
      Please analyze the issue and provide the corrected code using the fixCode tool.
      The code should be complete and ready to use.
    `,
      {
        outputTool: createFixCodeTool(),
      },
    );

    if (!response) {
      throw new Error('No response from agent');
    }

    // The response will be the result from the fixCode tool
    return response.code;
  } catch (error) {
    logger.error({ filePath: context.filePath, error }, 'Failed to fix code');
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
): Promise<string> => {
  try {
    logger.info({ filePath: context.filePath }, 'Fixing linting issues');

    if (!context.repositoryPath) {
      // Standalone mode: Use a minimal agent with a forced output tool
      const fixLintingTool = createFixLintingTool();
      const prompt = `I need you to fix the following linting issues in the code:

File: ${context.filePath || 'unknown'}
Language: ${context.language || 'unknown'}
Linter: ${context.linter || 'unknown'}
Issues:
${lintErrors.join('\\n')}

Here is the current code:
\`\`\`
${code}
\`\`\`

Please analyze the issues and provide the corrected code using the "${
        fixLintingTool.name
      }" tool. The code should be complete and ready to use.`;

      const agent = new Agent({
        basePath: '.',
        model: 'gpt-4', // Or a model from context if appropriate
        systemMessage: `You are a professional developer. Your task is to fix linting issues in the provided code. You MUST use the tool named "${fixLintingTool.name}" to return the corrected code.`,
        maxIterations: 3,
      });

      const response = await agent.run(prompt, {
        outputTool: fixLintingTool,
      });

      if (!response) {
        throw new Error('No response from agent for fixLinting');
      }

      logger.info(
        { filePath: context.filePath },
        'Linting fix completed via tool (standalone agent)',
      );
      return response.code;
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

    // Run the agent with the lint errors and code
    const response = await agent.run(
      `
      I need you to fix the following linting issues in the code:
      
      File: ${context.filePath || 'unknown'}
      Linter: ${context.linter || 'unknown'}
      Issues:
      ${lintErrors.join('\n')}
      
      Here is the current code:
      \`\`\`
      ${code}
      \`\`\`
      
      Please analyze the issues and provide the corrected code using the fixLinting tool.
      The code should be complete and ready to use.
    `,
      {
        outputTool: createFixLintingTool(),
      },
    );

    if (!response) {
      throw new Error('No response from agent');
    }

    // The response will be the result from the fixLinting tool
    return response.code;
  } catch (error) {
    logger.error({ filePath: context.filePath, error }, 'Failed to fix linting issues');
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
): Promise<string> => {
  try {
    logger.info({ filePath: context.filePath }, 'Fixing test failures');

    if (!context.repositoryPath) {
      // Standalone mode: Use a minimal agent with a forced output tool
      const fixTestsTool = createFixTestsTool();
      const prompt = `I need you to fix the following test failures:

File: ${context.filePath || 'unknown'}
Language: ${context.language || 'unknown'}
Test Framework: ${context.testFramework || 'unknown'}
Test Output:
${testOutput}

Here is the current code:
\`\`\`
${code}
\`\`\`

Please analyze the test failures and provide the corrected code using the "${
        fixTestsTool.name
      }" tool. The code should be complete and ready to use.`;

      const agent = new Agent({
        basePath: '.',
        model: 'gpt-4', // Or a model from context if appropriate
        systemMessage: `You are a professional developer. Your task is to fix test failures in the provided code. You MUST use the tool named "${fixTestsTool.name}" to return the corrected code.`,
        maxIterations: 3,
      });

      const response = await agent.run(prompt, {
        outputTool: fixTestsTool,
      });

      if (!response) {
        throw new Error('No response from agent for fixTests');
      }

      logger.info({ filePath: context.filePath }, 'Test fix completed via tool (standalone agent)');
      return response.code;
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

    // Run the agent with the test failures and code
    const response = await agent.run(
      `
      I need you to fix the following test failures:
      
      File: ${context.filePath || 'unknown'}
      Test Framework: ${context.testFramework || 'unknown'}
      Test Output:
      ${testOutput}
      
      Here is the current code:
      \`\`\`
      ${code}
      \`\`\`
      
      Please analyze the test failures and provide the corrected code using the fixTests tool.
      The code should be complete and ready to use.
    `,
      {
        outputTool: createFixTestsTool(),
      },
    );

    if (!response) {
      throw new Error('No response from agent');
    }

    // The response will be the result from the fixTests tool
    return response.code;
  } catch (error) {
    logger.error({ filePath: context.filePath, error }, 'Failed to fix test failures');
    throw new GitHubError(
      `Failed to fix test failures: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
