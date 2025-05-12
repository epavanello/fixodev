import { OpenAI } from 'openai';
import {
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions/completions';
import { envConfig } from '../config/env';
import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { Agent } from './agent';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirectoryTool,
  createFileExistsTool,
} from './tools/file';
import { createGrepTool, createFindFilesTool, createFindSymbolsTool } from './tools/search';
import { generateCodeAssistantSystemPrompt } from './prompts/system';
import { BotConfig } from '../types/config';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: envConfig.OPENAI_API_KEY,
});

export interface CodeContext {
  filePath?: string;
  language?: string;
  dependencies?: string[];
  linter?: BotConfig['linter'];
  testFramework?: BotConfig['testFramework'];
  projectType?: string;
  command?: string;
  repositoryPath?: string;
}

interface CodeChange {
  filePath: string;
  description: string;
  dependencies?: string[];
}

interface RepositoryAnalysis {
  changes: CodeChange[];
}

/**
 * Create and configure an Agent for a repository
 */
const createRepositoryAgent = (repositoryPath: string, context: CodeContext) => {
  // Create the agent
  const agent = new Agent({
    basePath: repositoryPath,
    model: 'gpt-4o',
    systemMessage: generateCodeAssistantSystemPrompt({
      taskType: 'feature',
      languages: [context.language || 'unknown'],
    }),
    verbose: true,
  });

  // Register file system tools
  agent.registerTool(createReadFileTool(repositoryPath));
  agent.registerTool(createWriteFileTool(repositoryPath));
  agent.registerTool(createListDirectoryTool(repositoryPath));
  agent.registerTool(createFileExistsTool(repositoryPath));

  // Register search tools
  agent.registerTool(createGrepTool(repositoryPath));
  agent.registerTool(createFindFilesTool(repositoryPath));
  agent.registerTool(createFindSymbolsTool(repositoryPath));

  return agent;
};

/**
 * Analyze code using LLM
 */
export const analyzeCode = async (context: CodeContext): Promise<RepositoryAnalysis> => {
  try {
    logger.info({ command: context.command }, 'Analyzing repository for changes');

    if (!context.repositoryPath) {
      throw new Error('Repository path is required for analysis');
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

    // Run the agent with the command
    const response = await agent.run(`
      I need you to analyze this repository and suggest changes based on the following request:
      "${context.command}"
      
      First, explore the repository structure to understand what we're working with.
      Then, identify the files that need to be modified to implement the requested changes.
      
      Return your analysis in JSON format with the following structure:
      {
        "changes": [
          {
            "filePath": "path/to/file",
            "description": "What changes are needed",
            "dependencies": ["dependency1", "dependency2"] // optional
          }
        ]
      }
    `);

    // Parse the response to extract the changes
    const jsonMatch =
      response.match(/```json\n([\s\S]*?)\n```/) ||
      response.match(/```\n([\s\S]*?)\n```/) ||
      response.match(/\{[\s\S]*"changes"[\s\S]*\}/);

    let result: RepositoryAnalysis;

    if (jsonMatch) {
      try {
        result = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } catch (error) {
        logger.error({ response, error }, 'Failed to parse JSON from response');
        result = { changes: [] };
      }
    } else {
      logger.warn({ response }, 'Could not extract JSON from response');
      result = { changes: [] };
    }

    logger.info({ command: context.command }, 'Repository analysis completed');

    return result;
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
      // Legacy approach without agent
      const prompt = `Fix the following issue in the code:
${issue}

File: ${context.filePath || 'unknown'}
Language: ${context.language || 'unknown'}
Dependencies: ${context.dependencies?.join(', ') || 'none'}

Code:
\`\`\`
${code}
\`\`\`

Please provide only the corrected code with no explanations. The code should be complete and ready to use.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional developer. Provide only the corrected code.',
          } as ChatCompletionSystemMessageParam,
          {
            role: 'user',
            content: prompt,
          } as ChatCompletionUserMessageParam,
        ],
        temperature: 0.2,
      });

      const fixedCode = response.choices[0].message.content || '';
      logger.info({ filePath: context.filePath }, 'Code fix completed');
      return fixedCode;
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

    // Run the agent with the issue and code
    const response = await agent.run(`
      I need you to fix an issue in the following code:
      
      File: ${context.filePath || 'unknown'}
      Issue: ${issue}
      
      Here is the current code:
      \`\`\`
      ${code}
      \`\`\`
      
      Please analyze the issue and provide only the corrected code with no explanations.
      The code should be complete and ready to use.
    `);

    // Extract the code from the response
    const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)\n```/);

    if (codeMatch) {
      logger.info({ filePath: context.filePath }, 'Code fix completed');
      return codeMatch[1];
    } else {
      // If no code block found, use the response as is
      logger.info({ filePath: context.filePath }, 'Code fix completed (no code block found)');
      return response;
    }
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
      // Legacy approach without agent
      const prompt = `Fix the following linting issues in the code:
${lintErrors.join('\n')}

File: ${context.filePath || 'unknown'}
Language: ${context.language || 'unknown'}
Linter: ${context.linter || 'unknown'}

Code:
\`\`\`
${code}
\`\`\`

Please provide only the corrected code with no explanations.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a professional developer. Provide only the corrected code.',
          } as ChatCompletionSystemMessageParam,
          {
            role: 'user',
            content: prompt,
          } as ChatCompletionUserMessageParam,
        ],
        temperature: 0.2,
      });

      const fixedCode = response.choices[0].message.content || '';
      logger.info({ filePath: context.filePath }, 'Linting fix completed');
      return fixedCode;
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

    // Run the agent with the lint errors and code
    const response = await agent.run(`
      I need you to fix the following linting issues in the code:
      
      File: ${context.filePath || 'unknown'}
      Linter: ${context.linter || 'unknown'}
      Issues:
      ${lintErrors.join('\n')}
      
      Here is the current code:
      \`\`\`
      ${code}
      \`\`\`
      
      Please analyze the issues and provide only the corrected code with no explanations.
      The code should be complete and ready to use.
    `);

    // Extract the code from the response
    const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)\n```/);

    if (codeMatch) {
      logger.info({ filePath: context.filePath }, 'Linting fix completed');
      return codeMatch[1];
    } else {
      // If no code block found, use the response as is
      logger.info({ filePath: context.filePath }, 'Linting fix completed (no code block found)');
      return response;
    }
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
      // Legacy approach without agent
      const prompt = `Fix the following test failures:
${testOutput}

File: ${context.filePath || 'unknown'}
Language: ${context.language || 'unknown'}
Test Framework: ${context.testFramework || 'unknown'}

Code:
\`\`\`
${code}
\`\`\`

Please provide only the corrected code with no explanations.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a professional developer. Provide only the corrected code.',
          } as ChatCompletionSystemMessageParam,
          {
            role: 'user',
            content: prompt,
          } as ChatCompletionUserMessageParam,
        ],
        temperature: 0.2,
      });

      const fixedCode = response.choices[0].message.content || '';
      logger.info({ filePath: context.filePath }, 'Test fix completed');
      return fixedCode;
    }

    // Create repository agent
    const agent = createRepositoryAgent(context.repositoryPath, context);

    // Run the agent with the test failures and code
    const response = await agent.run(`
      I need you to fix the following test failures:
      
      File: ${context.filePath || 'unknown'}
      Test Framework: ${context.testFramework || 'unknown'}
      Test Output:
      ${testOutput}
      
      Here is the current code:
      \`\`\`
      ${code}
      \`\`\`
      
      Please analyze the test failures and provide only the corrected code with no explanations.
      The code should be complete and ready to use.
    `);

    // Extract the code from the response
    const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)\n```/);

    if (codeMatch) {
      logger.info({ filePath: context.filePath }, 'Test fix completed');
      return codeMatch[1];
    } else {
      // If no code block found, use the response as is
      logger.info({ filePath: context.filePath }, 'Test fix completed (no code block found)');
      return response;
    }
  } catch (error) {
    logger.error({ filePath: context.filePath, error }, 'Failed to fix test failures');
    throw new GitHubError(
      `Failed to fix test failures: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
