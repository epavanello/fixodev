import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import pino from 'pino';
import { BotConfig } from '../types/config';
import {
  analyzeCode,
  fixCode,
  fixLinting as llmFixLinting,
  fixTests as llmFixTests,
} from '../llm/processor';
import { executeCommand } from '../docker/executor';
import { getFileLanguage, parseLintOutput, parseTestOutput } from '../utils/jobUtils';
import { logger as rootLogger } from '../config/logger';

const logger = rootLogger.child({ context: 'CommonJobLogic' });

export interface FixedFile {
  filePath: string;
  fixedCode: string;
}

/**
 * Applies changes to files based on the command analysis.
 * Returns true if any files were changed by this process.
 */
export async function applyChangesFromCommand(
  commandToApply: string,
  repoPath: string,
  config: BotConfig, // BotConfig from repository
  jobId: string,
  baseLogger: pino.Logger = logger,
): Promise<boolean> {
  baseLogger.info({ jobId }, 'Analyzing command for code changes');
  const { analysis, history } = await analyzeCode(
    {
      command: commandToApply,
      language: config.runtime,
    },
    repoPath,
  );

  let filesChangedCount = 0;
  if (analysis.changes && analysis.changes.length > 0) {
    baseLogger.info(
      { jobId, changeCount: analysis.changes.length },
      'Identified code changes from command.',
    );
    for (const change of analysis.changes) {
      const fullFilePath = join(repoPath, change.filePath);
      try {
        const fileContent = await readFile(fullFilePath, 'utf8');
        const fixedCode = await fixCode(
          fileContent,
          change.description,
          {
            filePath: change.filePath,
            language: getFileLanguage(change.filePath),
            dependencies: change.dependencies,
            history,
          },
          repoPath,
        );
        if (fixedCode) {
          await writeFile(fullFilePath, fixedCode, 'utf8');
          baseLogger.info(
            { jobId, file: change.filePath },
            'Applied LLM-suggested change from command.',
          );
          filesChangedCount++;
        }
      } catch (error) {
        baseLogger.error(
          { jobId, file: change.filePath, error },
          'Failed to apply change to file from command analysis',
        );
      }
    }
  } else {
    baseLogger.info({ jobId }, 'No code changes suggested by command analysis.');
  }
  return filesChangedCount > 0;
}

/**
 * Wraps the llmFixLinting logic, similar to the old fixLinting in worker.
 */
async function llmFixLintingWrapper(
  lintOutput: string,
  repoPath: string,
  config: BotConfig,
  jobId: string,
  baseLogger: pino.Logger = logger,
): Promise<FixedFile[]> {
  baseLogger.info({ jobId }, 'Attempting LLM-based lint fixes.');
  try {
    const lintIssues = parseLintOutput(lintOutput); // from jobUtils
    if (lintIssues.length === 0) {
      baseLogger.info({ jobId }, 'No lint issues parsed from output for LLM.');
      return [];
    }
    const fixedFiles: FixedFile[] = [];

    for (const { filePath, issues } of lintIssues) {
      const fullFilePath = join(repoPath, filePath);
      try {
        const fileContent = await readFile(fullFilePath, 'utf8');

        const fixedCode = await llmFixLinting(
          fileContent,
          issues,
          {
            filePath,
            language: getFileLanguage(filePath),
            linter: config.linter,
          },
          repoPath,
        );
        if (fixedCode) {
          fixedFiles.push({ filePath, fixedCode });
          baseLogger.info({ jobId, file: filePath }, 'LLM generated fix for linting issue.');
        }
      } catch (readError) {
        baseLogger.error(
          { jobId, file: filePath, error: readError },
          'Failed to read file for LLM lint fixing.',
        );
      }
    }
    return fixedFiles;
  } catch (error) {
    baseLogger.error({ jobId, error }, 'Failed to fix linting issues using LLM.');
    return [];
  }
}

/**
 * Wraps the llmFixTests logic, similar to the old fixTests in worker.
 */
async function llmFixTestsWrapper(
  testOutput: string,
  repoPath: string,
  config: BotConfig,
  jobId: string,
  baseLogger: pino.Logger = logger,
): Promise<FixedFile[]> {
  baseLogger.info({ jobId }, 'Attempting LLM-based test fixes.');
  try {
    const testFailures = parseTestOutput(testOutput);
    if (testFailures.length === 0) {
      baseLogger.info({ jobId }, 'No test failures parsed from output for LLM.');
      return [];
    }
    const fixedFiles: FixedFile[] = [];

    for (const { filePath, failures } of testFailures) {
      const fullFilePath = join(repoPath, filePath);
      try {
        const fileContent = await readFile(fullFilePath, 'utf8');

        const fixedCode = await llmFixTests(
          fileContent,
          failures.join('\n'),
          {
            filePath,
            language: getFileLanguage(filePath),
            testFramework: config.testFramework,
          },
          repoPath,
        );
        if (fixedCode) {
          fixedFiles.push({ filePath, fixedCode });
          baseLogger.info({ jobId, file: filePath }, 'LLM generated fix for test failure.');
        }
      } catch (readError) {
        baseLogger.error(
          { jobId, file: filePath, error: readError },
          'Failed to read file for LLM test fixing.',
        );
      }
    }
    return fixedFiles;
  } catch (error) {
    baseLogger.error({ jobId, error }, 'Failed to fix test failures using LLM.');
    return [];
  }
}

/**
 * Runs configured lint, test, and format scripts, applying LLM fixes if applicable.
 * Returns true if any files were changed by this process (lint/test fixes or formatting).
 */
export async function performAutomatedFixesAndFormat(
  repoPath: string,
  config: BotConfig,
  jobId: string,
  baseLogger: pino.Logger = logger,
): Promise<boolean> {
  let filesChangedByAutomation = false;

  // Linting
  if (config.scripts?.lint) {
    baseLogger.info({ jobId }, 'Running linting script.');
    const lintResult = await executeCommand({
      runtime: config.runtime,
      workspacePath: repoPath,
      command: config.scripts.lint,
    });
    baseLogger.info({ jobId, success: lintResult.success }, 'Linting script finished.');

    if (!lintResult.success) {
      const llmLintFixes = await llmFixLintingWrapper(
        lintResult.output,
        repoPath,
        config,
        jobId,
        baseLogger,
      );
      if (llmLintFixes.length > 0) {
        for (const { filePath, fixedCode } of llmLintFixes) {
          await writeFile(join(repoPath, filePath), fixedCode, 'utf8');
          baseLogger.info({ jobId, file: filePath }, 'Applied LLM lint fix.');
        }
        filesChangedByAutomation = true;
        // Re-run lint to confirm fixes (optional, could also check git status)
        baseLogger.info({ jobId }, 'Re-running lint script after LLM fixes.');
        const secondLintResult = await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.lint,
        });
        baseLogger.info({ jobId, success: secondLintResult.success }, 'Second lint run finished.');
      }
    }
  }

  // Testing
  if (config.scripts?.test) {
    baseLogger.info({ jobId }, 'Running test script.');
    const testResult = await executeCommand({
      runtime: config.runtime,
      workspacePath: repoPath,
      command: config.scripts.test,
    });
    baseLogger.info({ jobId, success: testResult.success }, 'Test script finished.');

    if (!testResult.success) {
      const llmTestFixes = await llmFixTestsWrapper(
        testResult.output,
        repoPath,
        config,
        jobId,
        baseLogger,
      );
      if (llmTestFixes.length > 0) {
        for (const { filePath, fixedCode } of llmTestFixes) {
          await writeFile(join(repoPath, filePath), fixedCode, 'utf8');
          baseLogger.info({ jobId, file: filePath }, 'Applied LLM test fix.');
        }
        filesChangedByAutomation = true;
        // Re-run tests to confirm fixes (optional)
        baseLogger.info({ jobId }, 'Re-running test script after LLM fixes.');
        const secondTestResult = await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.test,
        });
        baseLogger.info({ jobId, success: secondTestResult.success }, 'Second test run finished.');
      }
    }
  }

  // Formatting
  if (config.scripts?.format) {
    baseLogger.info({ jobId }, 'Running format script.');
    const formatResult = await executeCommand({
      runtime: config.runtime,
      workspacePath: repoPath,
      command: config.scripts.format,
    });
    baseLogger.info({ jobId, success: formatResult.success }, 'Format script finished.');
    if (formatResult.success) {
      // Formatting might change files. We can't easily tell if it did just from success true.
      // A more robust way is to check git status after this, which will be done in the handlers.
      // For now, if format script runs successfully, we assume it might have changed files.
      // filesChangedByAutomation = true; // This is too broad. Handlers will check git status.
    }
  }

  return filesChangedByAutomation;
}
