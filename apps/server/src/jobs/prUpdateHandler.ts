import { PrUpdateJob } from '../types/jobs';
import { cloneRepository, cleanupRepository } from '../git/clone';
import { commitChanges, pushChanges } from '../git/operations';
import { buildPullRequestContext, getPullRequest } from '../github/pr';
import { loadBotConfig } from '../utils/yaml';
import { JobError } from '../utils/error';
import { OperationLogger } from '@/utils/logger';
import { envConfig } from '../config/env';
import { processCodeModificationRequest } from '@/llm/processor';
import { taskCompletionTool } from '@/llm/tools/task';
import { RateLimitManager } from '../utils/rateLimit';
import { db } from '../db';
import {
  handleAuthentication,
  checkRateLimits,
  handleRateLimitExceeded,
  postInitialComment,
  cleanupInitialComment,
  postErrorComment,
  generateAndPostFormattedComment,
} from './shared';

export async function handlePrUpdateJob(job: PrUpdateJob): Promise<void> {
  const {
    id: jobId,
    repoOwner: originalRepoOwner,
    repoName: originalRepoName,
    prNumber,
    triggeredBy,
    repoUrl,
    installationId,
    instructions,
    testJob,
  } = job;

  const jobLogger = new OperationLogger({
    jobId,
    jobType: job.type,
    repo: `${originalRepoOwner}/${originalRepoName}`,
    pr: prNumber,
    triggeredBy,
  });

  // Initialize rate limit manager
  const rateLimitManager = new RateLimitManager(db);

  let repoPath: string | undefined;

  // Handle authentication
  const { octokit, cloneToken, repositoryToCloneUrl } = await handleAuthentication(
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
      prNumber,
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
    prNumber,
    triggeredBy,
    `👋 Hi @${triggeredBy}, I'm working on updating this PR based on your feedback! Stay tuned!`,
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

    // Get the latest PR data to ensure we have the most up-to-date information
    const latestPullRequest = await jobLogger.execute(
      () => getPullRequest(octokit, originalRepoOwner, originalRepoName, prNumber),
      'get latest pull request data',
    );

    // Checkout the PR's head branch instead of creating a new one
    const prHeadBranch = latestPullRequest.head.ref;

    const cloneResult = await jobLogger.execute(
      () => cloneRepository(repositoryToCloneUrl, prHeadBranch, cloneToken),
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

    // Build comprehensive context from the PR
    const comprehensiveContext = await jobLogger.execute(
      () =>
        buildPullRequestContext(
          octokit,
          originalRepoOwner,
          originalRepoName,
          latestPullRequest,
          instructions,
        ),
      'build comprehensive PR context',
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

    // Restore commit and push logic if changes were made and objective achieved
    if (hasPendingChanges && modificationResult?.output?.objectiveAchieved) {
      const commitMessage = `fix: Update PR based on feedback from @${triggeredBy} in ${originalRepoOwner}/${originalRepoName}#${prNumber}`;

      await jobLogger.execute(() => commitChanges(git, commitMessage), 'commit changes', {
        commitMessage,
        changedFiles: status.files.length,
      });

      await jobLogger.execute(() => pushChanges(git, prHeadBranch), 'push changes', {
        branchName: prHeadBranch,
      });
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
    const introMessage =
      hasPendingChanges && modificationResult?.output?.objectiveAchieved
        ? `✅ @${triggeredBy}, I've updated the PR based on your feedback! The changes have been pushed to the \`${prHeadBranch}\` branch.`
        : `✅ @${triggeredBy}, I received your feedback, but no actionable changes were identified or no changes were necessary after running checks.`;

    // Call the shared function to generate and post the comment
    await generateAndPostFormattedComment(
      octokit,
      originalRepoOwner,
      originalRepoName,
      prNumber,
      introMessage,
      modificationResult,
      testJob,
      jobLogger,
      { hasPendingChanges }, // Pass relevant metadata
    );
  } catch (error) {
    // Post error comment
    await postErrorComment(
      octokit,
      originalRepoOwner,
      originalRepoName,
      prNumber,
      triggeredBy,
      error,
      testJob,
      jobLogger,
    );

    if (error instanceof JobError) {
      throw error;
    }
    throw new JobError(
      `Failed to handle PrUpdateJob ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (repoPath && envConfig.CLEANUP_REPOSITORIES) {
      await jobLogger.safe(() => cleanupRepository(repoPath!), 'cleanup cloned repository', {
        repoPath,
      });
    }
  }
}
