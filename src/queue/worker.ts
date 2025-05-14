import { Job } from './job';
import { logger } from '../config/logger';
import pino from 'pino';
import { cloneRepository, cleanupRepository } from '../git/clone';
import { createBranch, commitChanges, pushChanges } from '../git/operations';
import { createPullRequest } from '../github/pr';
import { executeCommand } from '../docker/executor';
import { loadBotConfig } from '../utils/yaml';
import {
  fixLinting as llmFixLinting,
  fixTests as llmFixTests,
  fixCode,
  analyzeCode,
} from '../llm/processor';
import { GitHubApp } from '../github/app';
import { JobError } from '../utils/error';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { BotConfig } from '../types/config';
import { isIssueEvent, isIssueCommentEvent } from '../types/guards';
import { envConfig } from '../config/env';

const BOT_NAME = `@${envConfig.BOT_NAME}`;

/**
 * Checks if the bot should process this event based on mention and extracts command.
 */
function getBotCommand(body: string):
  | {
      shouldProcess: true;
      command: string;
    }
  | {
      shouldProcess: false;
      command: undefined;
    } {
  // Check for @bot mention
  if (body.includes(BOT_NAME)) {
    return { shouldProcess: true, command: body };
  }
  return { shouldProcess: false, command: undefined };
}

/**
 * Helper function to apply changes based on a comment.
 * Returns true if changes were made, false otherwise.
 */
async function applyChangesFromCommand(
  commandToApply: string, // Changed from commentBody
  repoPath: string,
  config: BotConfig,
  jobId: string,
  loggerInstance: pino.Logger,
): Promise<boolean> {
  loggerInstance.info({ jobId }, 'Analyzing command for changes');
  const analysis = await analyzeCode({
    command: commandToApply,
    repositoryPath: repoPath,
    language: config.runtime,
  });

  let filesChanged = false;
  if (analysis.changes && analysis.changes.length > 0) {
    for (const change of analysis.changes) {
      const fileContent = await readFile(join(repoPath, change.filePath), 'utf8');
      // Assuming fixCode takes a description of changes, not the full command
      // If fixCode expects the raw command, this might need adjustment
      const fixedCode = await fixCode(fileContent, change.description, {
        filePath: change.filePath,
        language: getFileLanguage(change.filePath),
        dependencies: change.dependencies,
      });
      if (fixedCode) {
        await writeFile(join(repoPath, change.filePath), fixedCode, 'utf8');
        loggerInstance.info(
          { jobId, file: change.filePath },
          'Applied requested changes from command',
        );
        filesChanged = true;
      }
    }
  } else {
    loggerInstance.info({ jobId }, 'No changes to apply from command analysis');
  }
  return filesChanged;
}

/**
 * Process a job from the queue
 */
export const processJob = async (job: Job): Promise<void> => {
  logger.info(
    { jobId: job.id, eventType: job.eventType, eventName: job.event.name },
    'Starting job processing',
  );

  let repoOwner: string | undefined;
  let repoName: string | undefined;
  let commandToProcess: string | undefined;
  let eventIssueNumber: number | undefined;
  let eventIssueTitle: string | undefined;

  if (
    job.eventType === 'issue_comment' &&
    isIssueCommentEvent(job.event.payload) &&
    job.event.payload.action === 'created'
  ) {
    const payload = job.event.payload;
    const { shouldProcess, command } = getBotCommand(payload.comment.body);
    if (!shouldProcess) {
      return;
    }
    commandToProcess = command;
    repoOwner = payload.repository.owner.login;
    repoName = payload.repository.name;
    eventIssueNumber = payload.issue.number;
    eventIssueTitle = payload.issue.title;

    logger.info(
      { jobId: job.id, command: commandToProcess },
      'Processing command from issue comment',
    );
  } else if (
    job.eventType === 'issues' &&
    isIssueEvent(job.event.payload) &&
    job.event.payload.action === 'opened'
  ) {
    const payload = job.event.payload;
    const { shouldProcess, command } = getBotCommand(payload.issue.body ?? '');
    if (!shouldProcess) {
      return;
    }
    commandToProcess = command;
    repoOwner = payload.repository.owner.login;
    repoName = payload.repository.name;
    eventIssueNumber = payload.issue.number;
    eventIssueTitle = payload.issue.title;
    logger.info({ jobId: job.id, command: commandToProcess }, 'Processing command from new issue');
  } else {
    logger.warn(
      {
        jobId: job.id,
        eventType: job.eventType,
        eventName: job.event.name,
      },
      'Job event type or action not configured for processing in worker. Skipping.',
    );
    return;
  }

  try {
    const githubApp = new GitHubApp();
    const octokit = await githubApp.getAuthenticatedClient(job.installationId);
    const token = await githubApp.getInstallationToken(job.installationId);
    const { path: repoPath, git } = await cloneRepository(job.repositoryUrl, undefined, token);

    try {
      const config = (await loadBotConfig(repoPath)) as BotConfig;
      const branchName = `job-${job.id}`;
      await createBranch(git, branchName);

      logger.info({ jobId: job.id }, 'Implementing requested changes from command');

      const filesChangedByCommand = await applyChangesFromCommand(
        commandToProcess,
        repoPath,
        config,
        job.id,
        logger,
      );

      if (config.scripts.lint) {
        logger.info({ jobId: job.id }, 'Running linting');
        const lintResult = await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.lint,
        });

        if (!lintResult.success) {
          const fixedFiles = await fixLinting(lintResult.output, repoPath, config);
          if (fixedFiles.length > 0) {
            for (const { filePath, fixedCode } of fixedFiles) {
              await writeFile(join(repoPath, filePath), fixedCode, 'utf8');
            }
            logger.info({ jobId: job.id }, 'Applied linting fixes');
          }
        }
      }

      if (config.scripts.test) {
        logger.info({ jobId: job.id }, 'Running tests');
        const testResult = await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.test,
        });

        if (!testResult.success) {
          const fixedFiles = await fixTests(testResult.output, repoPath, config);
          if (fixedFiles.length > 0) {
            for (const { filePath, fixedCode } of fixedFiles) {
              await writeFile(join(repoPath, filePath), fixedCode, 'utf8');
            }
            logger.info({ jobId: job.id }, 'Applied test fixes');
          }
        }
      }

      if (config.scripts.format) {
        logger.info({ jobId: job.id }, 'Running formatting');
        await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.format,
        });
      }

      const status = await git.status();
      const hasPendingChanges = status.files.length > 0;

      if (hasPendingChanges) {
        logger.info({ jobId: job.id }, 'Committing and pushing changes');
        await commitChanges(git, `Fix: Automated fixes by GitHub Bot (Job ${job.id})`);
        await pushChanges(git, branchName);

        await createPullRequest(octokit, {
          owner: repoOwner,
          repo: repoName,
          title: `Fix: ${eventIssueTitle?.slice(0, 50)}${eventIssueTitle && eventIssueTitle.length > 50 ? '...' : ''} by ${envConfig.BOT_NAME}`,
          head: branchName,
          base: config.branches.target,
          body: `This PR addresses the issue mentioned in #${eventIssueNumber}.`,
          labels: ['bot', BOT_NAME],
        });
        logger.info({ jobId: job.id }, 'Pull request created successfully');
      } else {
        logger.info({ jobId: job.id }, 'No changes to commit. Skipping PR creation.');
      }

      let replyMessage: string;

      if (!hasPendingChanges && !filesChangedByCommand) {
        // Also consider if command made changes
        replyMessage =
          "I received your request, but I wasn't able to make the requested changes, or no changes were necessary based on your command.";
        logger.info(
          { jobId: job.id, issueNumber: eventIssueNumber },
          'Replying that no changes were made or command was not actionable',
        );
      } else if (!hasPendingChanges && filesChangedByCommand) {
        replyMessage =
          "I've applied the changes you requested directly. No further pending changes to create a PR.";
        logger.info(
          { jobId: job.id, issueNumber: eventIssueNumber },
          'Replying that changes were made, but no PR (e.g. only formatting applied after command changes)',
        );
      } else {
        // hasPendingChanges
        replyMessage = "I've processed your request and created a pull request with the changes.";
        logger.info(
          { jobId: job.id, issueNumber: eventIssueNumber },
          'Replying with PR confirmation',
        );

        await octokit.issues.createComment({
          owner: repoOwner,
          repo: repoName,
          issue_number: eventIssueNumber,
          body: replyMessage,
        });
      }

      logger.info({ jobId: job.id }, 'Job completed successfully');
    } finally {
      if (envConfig.CLEANUP_REPOSITORIES) {
        await cleanupRepository(repoPath);
      }
    }
  } catch (error) {
    logger.error({ jobId: job.id, error }, 'Job processing failed');
    throw new JobError(
      `Job processing failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

interface FixedFile {
  filePath: string;
  fixedCode: string;
}

/**
 * Fix linting issues using LLM
 */
const fixLinting = async (
  lintOutput: string,
  repoPath: string,
  config: BotConfig,
): Promise<FixedFile[]> => {
  try {
    // Parse lint output to get file paths and issues
    const lintIssues = parseLintOutput(lintOutput);
    const fixedFiles: FixedFile[] = [];

    // Process each file with linting issues
    for (const { filePath, issues } of lintIssues) {
      // Read file content
      const fileContent = await readFile(join(repoPath, filePath), 'utf8');

      // Fix issues using LLM
      const fixedCode = await llmFixLinting(fileContent, issues, {
        filePath,
        language: getFileLanguage(filePath),
        linter: config.linter,
      });

      if (fixedCode) {
        fixedFiles.push({ filePath, fixedCode });
      }
    }

    return fixedFiles;
  } catch (error) {
    logger.error(error, 'Failed to fix linting issues');
    return [];
  }
};

/**
 * Fix test failures using LLM
 */
const fixTests = async (
  testOutput: string,
  repoPath: string,
  config: BotConfig,
): Promise<FixedFile[]> => {
  try {
    // Parse test output to get failing tests and affected files
    const testFailures = parseTestOutput(testOutput);
    const fixedFiles: FixedFile[] = [];

    // Process each file with test failures
    for (const { filePath, failures } of testFailures) {
      // Read file content
      const fileContent = await readFile(join(repoPath, filePath), 'utf8');

      // Fix failures using LLM
      const fixedCode = await llmFixTests(fileContent, failures.join('\n'), {
        filePath,
        language: getFileLanguage(filePath),
        testFramework: config.testFramework,
      });

      if (fixedCode) {
        fixedFiles.push({ filePath, fixedCode });
      }
    }

    return fixedFiles;
  } catch (error) {
    logger.error(error, 'Failed to fix test failures');
    return [];
  }
};

/**
 * Parse lint output to extract file paths and issues
 */
const parseLintOutput = (_output: string): Array<{ filePath: string; issues: string[] }> => {
  // TODO: Implement lint output parsing
  // This is a placeholder that needs to be implemented based on the linter being used
  return [];
};

/**
 * Parse test output to extract failing tests and affected files
 */
const parseTestOutput = (_output: string): Array<{ filePath: string; failures: string[] }> => {
  // TODO: Implement test output parsing
  // This is a placeholder that needs to be implemented based on the test framework being used
  return [];
};

/**
 * Get programming language from file extension
 */
const getFileLanguage = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    case 'rb':
      return 'ruby';
    case 'php':
      return 'php';
    case 'rs':
      return 'rust';
    default:
      return 'unknown';
  }
};
