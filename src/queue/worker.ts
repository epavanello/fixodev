import { Job } from './job';
import { logger } from '../config/logger';
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

/**
 * Process a job from the queue
 */
export const processJob = async (job: Job): Promise<void> => {
  try {
    logger.info({ jobId: job.id }, 'Starting job processing');

    // Initialize GitHub App for API access
    const githubApp = new GitHubApp();
    const octokit = await githubApp.getAuthenticatedClient(job.installationId);

    // Get installation token for Git operations
    const token = await githubApp.getInstallationToken(job.installationId);

    // Clone repository with authentication
    const { path: repoPath, git } = await cloneRepository(job.repositoryUrl, undefined, token);

    try {
      // Load bot configuration
      const config = (await loadBotConfig(repoPath)) as BotConfig;

      // Create branch for changes
      const branchName = `job-${job.id}`;
      await createBranch(git, branchName);

      // Implement requested changes using LLM
      if (isIssueCommentEvent(job.payload) || isPullRequestReviewCommentEvent(job.payload)) {
        logger.info({ jobId: job.id }, 'Implementing requested changes');
        const commentBody = job.payload.comment.body;

        // Let LLM analyze the repository and implement changes
        const analysis = await analyzeCode({
          command: commentBody,
          repositoryPath: repoPath,
          language: config.runtime,
        });

        // Apply the suggested changes
        for (const change of analysis.changes) {
          const fileContent = await readFile(join(repoPath, change.filePath), 'utf8');
          const fixedCode = await fixCode(fileContent, change.description, {
            filePath: change.filePath,
            language: getFileLanguage(change.filePath),
            dependencies: change.dependencies,
          });

          if (fixedCode) {
            await writeFile(join(repoPath, change.filePath), fixedCode, 'utf8');
            logger.info({ jobId: job.id, file: change.filePath }, 'Applied requested changes');
          }
        }
      }

      // Run linting if configured
      if (config.scripts.lint) {
        logger.info({ jobId: job.id }, 'Running linting');
        const lintResult = await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.lint,
        });

        if (!lintResult.success) {
          // Fix linting issues using LLM
          const fixedFiles = await fixLinting(lintResult.output, repoPath, config);
          if (fixedFiles.length > 0) {
            // Apply fixed code to files
            for (const { filePath, fixedCode } of fixedFiles) {
              await writeFile(join(repoPath, filePath), fixedCode, 'utf8');
            }
          }
        }
      }

      // Run tests if configured
      if (config.scripts.test) {
        logger.info({ jobId: job.id }, 'Running tests');
        const testResult = await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.test,
        });

        if (!testResult.success) {
          // Fix test failures using LLM
          const fixedFiles = await fixTests(testResult.output, repoPath, config);
          if (fixedFiles.length > 0) {
            // Apply fixed code to files
            for (const { filePath, fixedCode } of fixedFiles) {
              await writeFile(join(repoPath, filePath), fixedCode, 'utf8');
            }
          }
        }
      }

      // Run formatting if configured
      if (config.scripts.format) {
        logger.info({ jobId: job.id }, 'Running formatting');
        await executeCommand({
          runtime: config.runtime,
          workspacePath: repoPath,
          command: config.scripts.format,
        });
      }

      // Commit and push changes
      await commitChanges(git, `Fix: Automated fixes by GitHub Bot`);
      await pushChanges(git, branchName);

      // Create pull request
      const issueNumber = isIssueEvent(job.payload)
        ? job.payload.issue.number
        : isPullRequestEvent(job.payload)
          ? job.payload.pull_request.number
          : undefined;

      const commentBody = isIssueCommentEvent(job.payload)
        ? job.payload.comment.body
        : isPullRequestReviewCommentEvent(job.payload)
          ? job.payload.comment.body
          : undefined;

      const { title, body } = generatePRContent(
        job.eventType,
        job.payload.action || '',
        issueNumber,
        commentBody,
      );

      await createPullRequest(octokit, {
        owner: job.payload.repository.owner.login,
        repo: job.payload.repository.name,
        title,
        head: branchName,
        base: config.branches.target,
        body,
        labels: ['bot', 'automated-fix'],
      });

      logger.info({ jobId: job.id }, 'Job completed successfully');
    } finally {
      // Clean up repository
      await cleanupRepository(repoPath);
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
