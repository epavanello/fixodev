import { OpenAI } from 'openai';
import { envConfig } from '../config/env';
import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { generateFixPrompt, generateLintFixPrompt, generateTestFixPrompt } from './prompts/fix';
import { generateQualityAnalysisPrompt } from './prompts/analyze';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: envConfig.OPENAI_API_KEY,
});

interface CodeContext {
  filePath?: string;
  language?: string;
  dependencies?: string[];
  linter?: string;
  testFramework?: string;
  projectType?: string;
}

/**
 * Analyze code using LLM
 */
export const analyzeCode = async (
  code: string,
  context: CodeContext,
): Promise<{
  quality: string[];
  bugs: string[];
  performance: string[];
  security: string[];
  improvements: string[];
}> => {
  try {
    logger.info({ filePath: context.filePath }, 'Analyzing code');

    const prompt = generateQualityAnalysisPrompt(code, context);

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a professional code reviewer. Provide analysis in JSON format.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    logger.info({ filePath: context.filePath }, 'Code analysis completed');

    return result;
  } catch (error) {
    logger.error({ filePath: context.filePath, error }, 'Failed to analyze code');
    throw new GitHubError(
      `Failed to analyze code: ${error instanceof Error ? error.message : String(error)}`,
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

    const prompt = generateFixPrompt(code, issue, context);

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a professional developer. Provide only the corrected code.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const fixedCode = response.choices[0].message.content || '';

    logger.info({ filePath: context.filePath }, 'Code fix completed');

    return fixedCode;
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

    const prompt = generateLintFixPrompt(code, lintErrors, context);

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a professional developer. Provide only the corrected code.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const fixedCode = response.choices[0].message.content || '';

    logger.info({ filePath: context.filePath }, 'Linting fix completed');

    return fixedCode;
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

    const prompt = generateTestFixPrompt(code, testOutput, context);

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a professional developer. Provide only the corrected code.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const fixedCode = response.choices[0].message.content || '';

    logger.info({ filePath: context.filePath }, 'Test fix completed');

    return fixedCode;
  } catch (error) {
    logger.error({ filePath: context.filePath, error }, 'Failed to fix test failures');
    throw new GitHubError(
      `Failed to fix test failures: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
