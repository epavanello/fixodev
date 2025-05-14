import { Job } from './job';
import { logger } from '../config/logger';
import pino from 'pino';
import { cloneRepository, cleanupRepository } from '../git/clone';
import { createBranch, commitChanges, pushChanges } from '../git/operations';
import { createPullRequest, generatePRContent } from '../github/pr';
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
import {
  isIssueEvent,
  isPullRequestEvent,
  isIssueCommentEvent,
  isPullRequestReviewCommentEvent,
} from '../types/guards';
import { envConfig } from '../config/env';

/**
 * Helper function to apply changes based on a comment.
 * Returns true if changes were made, false otherwise.
 */
async function applyChangesFromComment(
  commentBody: string,
  repoPath: string,
  config: BotConfig,
  jobId: string,
  loggerInstance: pino.Logger,
): Promise<boolean> {
  loggerInstance.info({ jobId }, 'Analyzing comment for changes');
  const analysis = await analyzeCode({
    command: commentBody,
    repositoryPath: repoPath,
    language: config.runtime,
  });

  let filesChanged = false;
  if (analysis.changes && analysis.changes.length > 0) {
    for (const change of analysis.changes) {
      const fileContent = await readFile(join(repoPath, change.filePath), 'utf8');
      const fixedCode = await fixCode(fileContent, change.description, {
        filePath: change.filePath,
        language: getFileLanguage(change.filePath),
        dependencies: change.dependencies,
      });
      if (fixedCode) {
        await writeFile(join(repoPath, change.filePath), fixedCode, 'utf8');
        loggerInstance.info(
          { jobId, file: change.filePath },
          'Applied requested changes from comment',
        );
        filesChanged = true;
      }
    }
  } else {
    loggerInstance.info({ jobId }, 'No changes to apply from comment analysis');
  }
  return filesChanged;
}

/**
 * Process a job from the queue
 */
export const processJob = async (job: Job): Promise<void> => {
  try {
    logger.info({ jobId: job.id }, 'Starting job processing');

    const githubApp = new GitHubApp();
    const octokit = await githubApp.getAuthenticatedClient(job.installationId);
    const token = await githubApp.getInstallationToken(job.installationId);
    const { path: repoPath, git } = await cloneRepository(job.repositoryUrl, undefined, token);

    try {
      const config = (await loadBotConfig(repoPath)) as BotConfig;
      const branchName = `job-${job.id}`;
      await createBranch(git, branchName);

      let repoOwner: string | undefined;
      let repoName: string | undefined;

      interface OriginalCommentContext {
        owner: string;
        repo: string;
        numberForReply: number;
        isCommentEvent: boolean;
      }
      let originalCommentContext: OriginalCommentContext | undefined;

      if (isIssueEvent(job.event.payload) || isIssueCommentEvent(job.event.payload)) {
        repoOwner = job.event.payload.repository.owner.login;
        repoName = job.event.payload.repository.name;
      } else {
        logger.error(
          { jobId: job.id, payload: job.event.payload },
          'Could not determine repository owner or name from payload. Cannot proceed.',
        );
        throw new JobError(
          'Could not determine repository owner or name from payload. Cannot proceed.',
        );
      }

      if (!repoOwner || !repoName) {
        logger.error(
          { jobId: job.id, payload: job.event.payload },
          'Could not determine repository owner or name from payload. Cannot proceed.',
        );
        throw new JobError(
          'Could not determine repository owner or name from payload. Cannot proceed.',
        );
      }

      if (isIssueCommentEvent(job.event.payload)) {
        const commentPayload = job.event.payload;
        logger.info({ jobId: job.id }, 'Implementing requested changes for IssueCommentEvent');
        originalCommentContext = {
          owner: repoOwner,
          repo: repoName,
          numberForReply: commentPayload.issue.number,
          isCommentEvent: true,
        };
        await applyChangesFromComment(
          commentPayload.comment.body,
          repoPath,
          config,
          job.id,
          logger,
        );
      } else if (isPullRequestReviewCommentEvent(job.event.payload)) {
        const commentPayload = job.event.payload;
        logger.info(
          { jobId: job.id },
          'Implementing requested changes for PullRequestReviewCommentEvent',
        );
        originalCommentContext = {
          owner: repoOwner,
          repo: repoName,
          numberForReply: commentPayload.pull_request.number,
          isCommentEvent: true,
        };
        await applyChangesFromComment(
          commentPayload.comment.body,
          repoPath,
          config,
          job.id,
          logger,
        );
      } else {
        logger.info(
          { jobId: job.id, event: job.event },
          'No changes to apply from comment analysis',
        );
      }

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

        let issueNumberForPRBody: number | undefined;
        let prActionForPRBody: string = '';
        let commentBodyForPRBody: string | undefined;

        if (isIssueEvent(job.event.payload)) {
          issueNumberForPRBody = job.event.payload.issue.number;
          prActionForPRBody = job.event.payload.action;
        } else if (isPullRequestEvent(job.event.payload)) {
          issueNumberForPRBody = job.event.payload.pull_request.number;
          prActionForPRBody = job.event.payload.action;
        }

        if (isIssueCommentEvent(job.event.payload)) {
          commentBodyForPRBody = job.event.payload.comment.body;
          if (!prActionForPRBody) prActionForPRBody = job.event.payload.action;
          if (!issueNumberForPRBody) issueNumberForPRBody = job.event.payload.issue.number;
        } else if (isPullRequestReviewCommentEvent(job.event.payload)) {
          commentBodyForPRBody = job.event.payload.comment.body;
          if (!prActionForPRBody) prActionForPRBody = job.event.payload.action;
          if (!issueNumberForPRBody) {
            issueNumberForPRBody = job.event.payload.pull_request.number;
          }
        }

        if (!repoOwner || !repoName) {
          logger.error(
            { jobId: job.id, payload: job.event.payload },
            'Could not determine repository owner or name for PR',
          );
          throw new JobError('Could not determine repository owner or name for PR');
        }

        const { title, body } = generatePRContent(
          job.eventType,
          prActionForPRBody,
          issueNumberForPRBody,
          commentBodyForPRBody,
        );

        await createPullRequest(octokit, {
          owner: repoOwner,
          repo: repoName,
          title,
          head: branchName,
          base: config.branches.target,
          body,
          labels: ['bot', 'automated-fix'],
        });
        logger.info({ jobId: job.id }, 'Pull request created successfully');
      } else {
        logger.info({ jobId: job.id }, 'No changes to commit. Skipping PR creation.');
      }

      if (originalCommentContext?.isCommentEvent) {
        let replyMessage: string;
        if (!hasPendingChanges) {
          replyMessage =
            "I apologize, but I wasn't able to make the requested changes, or no changes were necessary.";
          logger.info(
            { jobId: job.id, issueNumber: originalCommentContext.numberForReply },
            'Replying that no changes were made',
          );
        } else {
          replyMessage = "I've processed your request and created a pull request.";
          logger.info(
            { jobId: job.id, issueNumber: originalCommentContext.numberForReply },
            'Replying with PR confirmation',
          );
        }

        await octokit.issues.createComment({
          owner: originalCommentContext.owner,
          repo: originalCommentContext.repo,
          issue_number: originalCommentContext.numberForReply,
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
