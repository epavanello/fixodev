import { IssueToPrJob } from '../types/jobs';
import { GitHubApp } from '../github/app';
import { Octokit } from '@octokit/rest';
import { cloneRepository, cleanupRepository } from '../git/clone';
import { createBranch, commitChanges, pushChanges } from '../git/operations';
import { createPullRequest } from '../github/pr';
import { loadBotConfig } from '../utils/yaml';
import { JobError } from '../utils/error';
import { OperationLogger } from '@/utils/logger';
import { envConfig } from '../config/env';
import { ensureForkExists } from '../git/fork';
import { processCodeModificationRequest } from '@/llm/processor';
import { taskCompletionTool } from '@/llm/tools/task';
import { RateLimitManager } from '../utils/rateLimit';
import { db } from '../db';
import { buildIssueContext } from '../github/issue';

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

  let octokit: Octokit;
  let repoPath: string | undefined;
  let cloneToken: string | undefined;
  let repositoryToCloneUrl: string;
  let headBranchOwner: string = originalRepoOwner;

  if (installationId) {
    const githubApp = new GitHubApp();
    octokit = await jobLogger.execute(
      () => githubApp.getAuthenticatedClient(installationId),
      'authenticate GitHub App client',
      { installationId },
    );

    cloneToken = await jobLogger.execute(
      () => githubApp.getInstallationToken(installationId),
      'get GitHub App installation token',
      { installationId },
    );
    repositoryToCloneUrl = repoUrl;
    headBranchOwner = originalRepoOwner;
  } else {
    if (!envConfig.BOT_USER_PAT || !envConfig.BOT_NAME) {
      throw new JobError(
        'UserIssueToPrJob handler is not configured with BOT_USER_PAT or BOT_NAME.',
      );
    }
    octokit = new Octokit({ auth: envConfig.BOT_USER_PAT });
    cloneToken = envConfig.BOT_USER_PAT;
    headBranchOwner = envConfig.BOT_NAME;

    const forkResult = await jobLogger.execute(
      () => ensureForkExists(octokit, originalRepoOwner, originalRepoName, headBranchOwner),
      'ensure fork exists',
      { headBranchOwner },
    );
    repositoryToCloneUrl = forkResult.forkCloneUrl;
    headBranchOwner = forkResult.forkOwner;
  }

  // Check rate limits for both triggeredBy and repoOwner
  const [triggeredByCheck, repoOwnerCheck] = await jobLogger.execute(
    () =>
      Promise.all([
        rateLimitManager.checkRateLimit(triggeredBy, 'triggeredBy'),
        rateLimitManager.checkRateLimit(originalRepoOwner, 'repoOwner'),
      ]),
    'check rate limits',
    { triggeredBy, repoOwner: originalRepoOwner },
  );

  // If either user has exceeded their limits, post a rate limit message and exit
  if (!triggeredByCheck.allowed || !repoOwnerCheck.allowed) {
    const limitExceededUser = !triggeredByCheck.allowed ? triggeredBy : originalRepoOwner;
    const limitExceededCheck = !triggeredByCheck.allowed ? triggeredByCheck : repoOwnerCheck;
    const limitExceededUserType = !triggeredByCheck.allowed ? 'triggeredBy' : 'repoOwner';

    const rateLimitMessage = rateLimitManager.generateRateLimitMessage(
      triggeredBy,
      limitExceededCheck,
      limitExceededUserType,
    );

    if (!testJob) {
      await jobLogger.safe(
        () =>
          octokit.issues.createComment({
            owner: originalRepoOwner,
            repo: originalRepoName,
            issue_number: eventIssueNumber,
            body: rateLimitMessage,
          }),
        'post rate limit exceeded message',
        { limitExceededUser, limitExceededUserType, reason: limitExceededCheck.reason },
      );
    }

    return; // Exit early due to rate limit
  }

  let initialCommentId: number | undefined;

  try {
    if (!testJob) {
      const initialComment = await jobLogger.execute(
        () =>
          octokit.issues.createComment({
            owner: originalRepoOwner,
            repo: originalRepoName,
            issue_number: eventIssueNumber,
            body: `👋 Hi @${triggeredBy}, I'm on it! I'll apply changes, and open a PR if needed. Stay tuned!`,
          }),
        'post acknowledgment comment',
      );
      initialCommentId = initialComment.data.id;

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
    if (hasPendingChanges && modificationResult?.objectiveAchieved) {
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

    if (initialCommentId && !testJob) {
      await jobLogger.safe(
        () =>
          octokit.issues.deleteComment({
            owner: originalRepoOwner,
            repo: originalRepoName,
            comment_id: initialCommentId!,
          }),
        'delete initial acknowledgment comment',
        { initialCommentId },
      );
    }

    if (!testJob) {
      let replyMessage: string;
      if (prUrl) {
        replyMessage = `✅ @${triggeredBy}, I've created a pull request for you: ${prUrl}`;
      } else {
        replyMessage = `✅ @${triggeredBy}, I received your request, but no actionable changes were identified or no changes were necessary after running checks.`;
      }
      await jobLogger.execute(
        () =>
          octokit.issues.createComment({
            owner: originalRepoOwner,
            repo: originalRepoName,
            issue_number: eventIssueNumber,
            body: replyMessage,
          }),
        'post final reply comment',
        { prUrl },
      );
    }
  } catch (error) {
    if (initialCommentId && !testJob) {
      await jobLogger.safe(
        () =>
          octokit.issues.deleteComment({
            owner: originalRepoOwner,
            repo: originalRepoName,
            comment_id: initialCommentId!,
          }),
        'delete initial comment during error handling',
        { initialCommentId },
      );
    }

    if (!testJob) {
      await jobLogger.safe(
        () =>
          octokit.issues.createComment({
            owner: originalRepoOwner,
            repo: originalRepoName,
            issue_number: eventIssueNumber,
            body: `🚧 Oops, @${triggeredBy}! I encountered an error while working on your request.\n\n\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\`\n\nPlease check the logs if you have access.`,
          }),
        'post error comment to GitHub issue',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

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
