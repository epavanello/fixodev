import { IssueToPrJob } from '../types/jobs';
import { cloneRepository, cleanupRepository } from '../git/clone';
import { createBranch, commitChanges, pushChanges } from '../git/operations';
import { createPullRequest } from '../github/pr';
import { loadBotConfig } from '../utils/yaml';
import { JobError } from '../utils/error';
import { OperationLogger } from '@/utils/logger';
import { envConfig } from '../config/env';
import { processCodeModificationRequest } from '@/llm/processor';
import { taskCompletionTool } from '@/llm/tools/task';
import { RateLimitManager } from '../utils/rateLimit';
import { db } from '../db';
import { buildIssueContext } from '../github/issue';
import {
  handleAuthentication,
  checkRateLimits,
  handleRateLimitExceeded,
  postInitialComment,
  cleanupInitialComment,
  postErrorComment,
  generateAndPostFormattedComment,
} from './shared';

export async function handleIssueToPrJob(job: IssueToPrJob): Promise<void> {
  const {
    id: jobId,
    repoOwner: originalRepoOwner,
    repoName: originalRepoName,
    issueNumber: eventIssueNumber,
    triggeredBy,
    repoUrl,
    installationId,
    issue,
    testJob,
  } = job;

  const jobLogger = new OperationLogger({
    jobId,
    jobType: job.type,
    repo: `${originalRepoOwner}/${originalRepoName}`,
    issue: eventIssueNumber,
    triggeredBy,
  });

  // Initialize rate limit manager
  const rateLimitManager = new RateLimitManager(db);

  let repoPath: string | undefined;

  // Handle authentication
  const { octokit, cloneToken, repositoryToCloneUrl, headBranchOwner } = await handleAuthentication(
    installationId,
    originalRepoOwner,
    originalRepoName,
    repoUrl,
    jobLogger,
  );

  // Check rate limits
  const rateLimitResult = await checkRateLimits(
    rateLimitManager,
    triggeredBy,
    originalRepoOwner,
    jobLogger,
  );

  if (!rateLimitResult.allowed) {
    await handleRateLimitExceeded(
      rateLimitManager,
      triggeredBy,
      rateLimitResult.triggeredByCheck,
      rateLimitResult.repoOwnerCheck,
      octokit,
      originalRepoOwner,
      originalRepoName,
      eventIssueNumber,
      testJob,
      jobLogger,
    );
    return;
  }

  // Post initial comment and record execution
  const initialCommentId = await postInitialComment(
    octokit,
    originalRepoOwner,
    originalRepoName,
    eventIssueNumber,
    triggeredBy,
    `👋 Hi @${triggeredBy}, I'm on it! I'll apply changes, and open a PR if needed. Stay tuned!`,
    testJob,
    jobLogger,
  );

  try {
    if (!testJob) {
      // Record the execution for rate limiting
      await jobLogger.execute(
        () =>
          rateLimitManager.recordExecution({
            jobId,
            triggeredBy,
            repoOwner: originalRepoOwner,
            repoName: originalRepoName,
            jobType: job.type,
          }),
        'record execution for rate limiting',
      );
    }

    const cloneResult = await jobLogger.execute(
      () => cloneRepository(repositoryToCloneUrl, undefined, cloneToken),
      'clone repository',
      { repositoryToCloneUrl },
    );
    repoPath = cloneResult.path;
    const git = cloneResult.git;

    const botConfig = await jobLogger.execute(
      () => loadBotConfig(repoPath!),
      'load bot configuration',
      { repoPath },
    );

    const branchName = `${envConfig.BOT_NAME}/${eventIssueNumber}-${Date.now().toString().slice(-6)}`;
    await jobLogger.execute(() => createBranch(git, branchName), 'create new branch', {
      branchName,
    });

    // Build comprehensive context from the issue
    const comprehensiveContext = await jobLogger.execute(
      () => buildIssueContext(octokit, originalRepoOwner, originalRepoName, issue),
      'build comprehensive issue context',
    );

    const modificationResult = await jobLogger.execute(
      () =>
        processCodeModificationRequest(
          comprehensiveContext,
          repoPath!,
          botConfig,
          true,
          taskCompletionTool,
        ),
      'process code modification request',
    );

    const status = await jobLogger.execute(() => git.status(), 'check repository status');
    const hasPendingChanges = status.files.length > 0;

    let prUrl: string | undefined;
    if (hasPendingChanges && modificationResult?.output?.objectiveAchieved) {
      const commitMessage = `fix: Automated changes for ${originalRepoOwner}/${originalRepoName}#${eventIssueNumber} by ${envConfig.BOT_NAME}`;

      await jobLogger.execute(() => commitChanges(git, commitMessage), 'commit changes', {
        commitMessage,
        changedFiles: status.files.length,
      });

      await jobLogger.execute(() => pushChanges(git, branchName), 'push changes', { branchName });

      if (!testJob) {
        prUrl = await jobLogger.execute(
          () =>
            createPullRequest(octokit, {
              owner: originalRepoOwner,
              repo: originalRepoName,
              title: `🤖 Fix for "${issue.title.slice(0, 40)}${issue.title.length > 40 ? '...' : ''}" by ${envConfig.BOT_NAME}`,
              head: `${headBranchOwner}:${branchName}`,
              base: botConfig.branches.target || 'main',
              body: `This PR addresses the mention of @${envConfig.BOT_NAME} in ${originalRepoOwner}/${originalRepoName}#${eventIssueNumber}.\n\nTriggered by: @${triggeredBy}`,
              labels: ['bot', envConfig.BOT_NAME.toLowerCase()],
            }),
          'create pull request',
          { branchName, headBranchOwner },
        );
      }
    }

    // Clean up initial comment
    if (initialCommentId) {
      await cleanupInitialComment(
        octokit,
        originalRepoOwner,
        originalRepoName,
        initialCommentId,
        testJob,
        jobLogger,
      );
    }

    // Construct the introductory message for the comment
    const introMessage = prUrl
      ? `✅ @${triggeredBy}, I've created a pull request for you: ${prUrl}`
      : `✅ @${triggeredBy}, I received your request, but no actionable changes were identified or no changes were necessary after running checks.`;

    // Call the shared function to generate and post the comment
    await generateAndPostFormattedComment(
      octokit,
      originalRepoOwner,
      originalRepoName,
      eventIssueNumber,
      triggeredBy,
      introMessage,
      modificationResult,
      testJob,
      jobLogger,
      { prUrl },
    );
  } catch (error) {
    // Clean up initial comment on error
    if (initialCommentId) {
      await cleanupInitialComment(
        octokit,
        originalRepoOwner,
        originalRepoName,
        initialCommentId,
        testJob,
        jobLogger,
      );
    }

    // Post error comment
    await postErrorComment(
      octokit,
      originalRepoOwner,
      originalRepoName,
      eventIssueNumber,
      triggeredBy,
      error,
      testJob,
      jobLogger,
    );

    if (error instanceof JobError) {
      throw error;
    }
    throw new JobError(
      `Failed to handle IssueToPrJob ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (repoPath && envConfig.CLEANUP_REPOSITORIES) {
      await jobLogger.safe(() => cleanupRepository(repoPath!), 'cleanup cloned repository', {
        repoPath,
      });
    }
  }
}
