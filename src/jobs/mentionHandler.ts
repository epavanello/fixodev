import {
  isAppMentionOnIssueJob,
  isUserMentionOnIssueJob,
  isAppMentionOnPullRequestJob,
  WorkerJob,
} from "../types/jobs";
import { BotConfig } from "../types/config";
import { logger as rootLogger } from "../config/logger";
import { GitHubApp } from "../github/app";
import { Octokit } from "@octokit/rest";
import { cloneRepository, cleanupRepository } from "../git/clone";
import { createBranch, commitChanges, pushChanges, checkout } from "../git/operations";
import { createPullRequest, addCommentToPullRequest, getPullRequest } from "../github/pr";
import { loadBotConfig } from "../utils/yaml";
import { JobError } from "../utils/error";
import { envConfig } from "../config/env";
import { ensureForkExists, ForkResult } from "../git/fork";
import { processCodeModificationRequest } from "@/llm/processor";
import { taskCompletionTool } from "@/llm/tools/task";
import { RateLimitManager } from "../utils/rateLimit";
import { db } from "../db";

const handlerLogger = rootLogger.child({ context: "MentionJobHandler" });

export async function handleMentionJob(job: WorkerJob): Promise<void> {
  const {
    id: jobId,
    originalRepoOwner,
    originalRepoName,
    commandToProcess,
    triggeredBy,
  } = job;

  const logger = handlerLogger.child({
    jobId,
    jobType: job.type,
    repo: `${originalRepoOwner}/${originalRepoName}`,
    triggeredBy,
    ...(isAppMentionOnIssueJob(job) && { issue: job.eventIssueNumber }),
    ...(isUserMentionOnIssueJob(job) && { issue: job.eventIssueNumber }),
    ...(isAppMentionOnPullRequestJob(job) && { pr: job.eventPullRequestNumber }),
  });

  logger.info("Starting MentionJob handling.");

  // Initialize rate limit manager
  const rateLimitManager = new RateLimitManager(db);

  let octokit: Octokit;
  let repoPath: string | undefined;
  let cloneToken: string | undefined;
  let repositoryToCloneUrl: string;
  let headBranchOwner: string = originalRepoOwner;
  let targetBranch: string = "main"; // Default target branch
  let eventNumber: number; // Issue or PR number
  let eventTitle: string; // Issue or PR title

  if (isAppMentionOnIssueJob(job)) {
    logger.info("Job identified as AppMentionOnIssueJob. Setting up GitHub App authentication.");
    const githubApp = new GitHubApp();
    octokit = await githubApp.getAuthenticatedClient(job.installationId);
    cloneToken = await githubApp.getInstallationToken(job.installationId);
    repositoryToCloneUrl = job.repositoryUrl;
    headBranchOwner = originalRepoOwner;
    eventNumber = job.eventIssueNumber;
    eventTitle = job.eventIssueTitle;
    logger.info("Successfully authenticated as GitHub App installation.");
  } else if (isUserMentionOnIssueJob(job)) {
    logger.info("Job identified as UserMentionOnIssueJob. Setting up PAT authentication and forking.");
    if (!envConfig.BOT_USER_PAT || !envConfig.BOT_NAME) {
      logger.error("BOT_USER_PAT or BOT_NAME not configured for UserMentionOnIssueJob.");
      throw new JobError(
        "UserMentionOnIssueJob handler is not configured with BOT_USER_PAT or BOT_NAME.",
      );
    }
    octokit = new Octokit({ auth: envConfig.BOT_USER_PAT });
    cloneToken = envConfig.BOT_USER_PAT;
    headBranchOwner = envConfig.BOT_NAME;
    eventNumber = job.eventIssueNumber;
    eventTitle = job.eventIssueTitle;

    logger.info(`Authenticating as user @${headBranchOwner} for fork operations.`);
    const forkResult: ForkResult = await ensureForkExists(
      octokit,
      originalRepoOwner,
      originalRepoName,
      headBranchOwner,
    );
    repositoryToCloneUrl = forkResult.forkCloneUrl;
    headBranchOwner = forkResult.forkOwner; // Use the actual owner of the fork
    logger.info(
      `Ensured fork exists: ${forkResult.forkOwner}/${forkResult.forkRepoName} at ${repositoryToCloneUrl}`,
    );
  } else if (isAppMentionOnPullRequestJob(job)) {
    logger.info("Job identified as AppMentionOnPullRequestJob. Setting up GitHub App authentication.");
    const githubApp = new GitHubApp();
    octokit = await githubApp.getAuthenticatedClient(job.installationId);
    cloneToken = await githubApp.getInstallationToken(job.installationId);
    repositoryToCloneUrl = job.repositoryUrl;
    headBranchOwner = originalRepoOwner; // For PRs, the head branch owner is usually the original repo owner or a fork
    eventNumber = job.eventPullRequestNumber;
    eventTitle = job.eventPullRequestTitle;
    targetBranch = job.prHeadRef; // The target branch for changes is the PR's head ref
    logger.info("Successfully authenticated as GitHub App installation.");
  } else {
    throw new JobError(`Unknown job type for job ID ${jobId}`);
  }

  // Check rate limits for both triggeredBy and repoOwner
  const triggeredByCheck = await rateLimitManager.checkRateLimit(triggeredBy, "triggeredBy");
  const repoOwnerCheck = await rateLimitManager.checkRateLimit(originalRepoOwner, "repoOwner");

  logger.info(
    {
      triggeredByCheck: {
        allowed: triggeredByCheck.allowed,
        planType: triggeredByCheck.planType,
        usage: triggeredByCheck.usage,
        reason: triggeredByCheck.reason,
      },
      repoOwnerCheck: {
        allowed: repoOwnerCheck.allowed,
        planType: repoOwnerCheck.planType,
        usage: repoOwnerCheck.usage,
        reason: repoOwnerCheck.reason,
      },
    },
    "Rate limit check results",
  );

  // If either user has exceeded their limits, post a rate limit message and exit
  if (!triggeredByCheck.allowed || !repoOwnerCheck.allowed) {
    const limitExceededUser = !triggeredByCheck.allowed ? triggeredBy : originalRepoOwner;
    const limitExceededCheck = !triggeredByCheck.allowed ? triggeredByCheck : repoOwnerCheck;
    const limitExceededUserType = !triggeredByCheck.allowed ? "triggeredBy" : "repoOwner";

    const rateLimitMessage = rateLimitManager.generateRateLimitMessage(
      triggeredBy,
      limitExceededCheck,
      limitExceededUserType,
    );

    try {
      if (isAppMentionOnPullRequestJob(job)) {
        await addCommentToPullRequest(octokit, {
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: eventNumber,
          body: rateLimitMessage,
        });
      } else {
        await octokit.issues.createComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: eventNumber,
          body: rateLimitMessage,
        });
      }
      logger.info(
        {
          limitExceededUser,
          limitExceededUserType,
          reason: limitExceededCheck.reason,
        },
        "Posted rate limit exceeded message",
      );
    } catch (commentError) {
      logger.error({ commentError }, "Failed to post rate limit message");
    }

    return; // Exit early due to rate limit
  }

  let initialCommentId: number | undefined;

  try {
    let initialCommentBody = `👋 Hi @${triggeredBy}, I\'m on it! I\'ll apply changes, and open a PR if needed. Stay tuned!`;
    if (isAppMentionOnPullRequestJob(job)) {
      initialCommentBody = `👋 Hi @${triggeredBy}, I\'m on it! I\'ll apply changes to PR #${job.eventPullRequestNumber}. Stay tuned!`;
    }

    let initialComment;
    if (isAppMentionOnPullRequestJob(job)) {
      initialComment = await addCommentToPullRequest(octokit, {
        owner: originalRepoOwner,
        repo: originalRepoName,
        issue_number: eventNumber,
        body: initialCommentBody,
      });
    } else {
      initialComment = await octokit.issues.createComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        issue_number: eventNumber,
        body: initialCommentBody,
      });
    }
    // Note: addCommentToPullRequest doesn't return the comment ID directly, so we can't delete it later for PR comments.
    // This is a limitation of the current Octokit API for PR comments vs issue comments.
    // For now, we'll only set initialCommentId if it's an issue comment.
    if (!isAppMentionOnPullRequestJob(job)) {
      initialCommentId = initialComment.data.id;
    }
    logger.info("Posted acknowledgment comment.");

    // Record the execution for rate limiting
    await rateLimitManager.recordExecution({
      jobId,
      triggeredBy,
      repoOwner: originalRepoOwner,
      repoName: originalRepoName,
      jobType: job.type,
    });

    let cloneResult;
    if (isAppMentionOnPullRequestJob(job)) {
      // For PR comments, clone the PR's head ref
      cloneResult = await cloneRepository(
        repositoryToCloneUrl,
        job.prHeadRef,
        cloneToken,
      );
    } else {
      cloneResult = await cloneRepository(repositoryToCloneUrl, undefined, cloneToken);
    }

    repoPath = cloneResult.path;
    const git = cloneResult.git;
    logger.info({ repoPath }, "Repository cloned successfully.");

    // If it's a PR job, ensure we are on the correct branch/SHA
    if (isAppMentionOnPullRequestJob(job)) {
      logger.info({ prHeadRef: job.prHeadRef, prHeadSha: job.prHeadSha }, "Checking out PR head ref/sha.");
      // First, ensure we are on the correct branch, then checkout the specific SHA
      await checkout(git, job.prHeadRef);
      await checkout(git, job.prHeadSha);
    }

    const botConfig = (await loadBotConfig(repoPath)) as BotConfig;
    logger.info({ botConfig }, "Loaded bot configuration.");

    let branchName: string;
    let isNewPr: boolean = true;

    if (isAppMentionOnPullRequestJob(job)) {
      // For PR comments, we work directly on the PR's head branch
      branchName = job.prHeadRef;
      isNewPr = false;
      logger.info({ branchName }, "Working on existing PR branch.");
    } else {
      // For issue mentions, create a new branch
      branchName = `${envConfig.BOT_NAME}/${eventNumber}-${Date.now().toString().slice(-6)}`;
      await createBranch(git, branchName);
      logger.info({ branchName }, "Created new branch for issue.");
    }

    const modificationResult = await processCodeModificationRequest(
      commandToProcess,
      repoPath,
      botConfig,
      true,
      taskCompletionTool,
    );
    logger.info({ modificationResult }, "Result of applying command changes.");

    const status = await git.status();
    const hasPendingChanges = status.files.length > 0;
    logger.info(
      { hasPendingChanges, changedFileCount: status.files.length },
      "Checked repository status for changes.",
    );

    let prUrl: string | undefined;
    if (hasPendingChanges && modificationResult?.objectiveAchieved) {
      logger.info("Committing and pushing changes.");
      const commitMessage = `fix: Automated changes for ${originalRepoOwner}/${originalRepoName}#${eventNumber} by @${envConfig.BOT_NAME}`;

      await commitChanges(git, commitMessage);
      await pushChanges(git, branchName);
      logger.info("Changes committed and pushed.");

      if (isNewPr) {
        const pr = await createPullRequest(octokit, {
          owner: originalRepoOwner,
          repo: originalRepoName,
          title: `🤖 Fix for "${eventTitle.slice(0, 40)}${eventTitle.length > 40 ? "..." : ""}" by @${envConfig.BOT_NAME}`,
          head: `${headBranchOwner}:${branchName}`,
          base: botConfig.branches.target || "main",
          body: `This PR addresses the mention of @${envConfig.BOT_NAME} in ${originalRepoOwner}/${originalRepoName}#${eventNumber}.\n\nTriggered by: @${triggeredBy}`,
          labels: ["bot", envConfig.BOT_NAME.toLowerCase()],
        });
        prUrl = pr;
        logger.info({ prUrl }, "Pull request created successfully.");
      } else {
        // For existing PRs, the changes are pushed to the existing head branch
        // No new PR creation needed, just update the existing one implicitly by pushing
        logger.info({ branchName }, "Changes pushed to existing PR branch. PR will be updated.");
        // We can try to get the PR URL again if needed, but it's already known from the job
        prUrl = `https://github.com/${originalRepoOwner}/${originalRepoName}/pull/${eventNumber}`;
      }
    } else {
      logger.info("No changes to commit. Skipping PR creation/update.");
    }

    if (initialCommentId) {
      await octokit.issues.deleteComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        comment_id: initialCommentId,
      });
      logger.info("Deleted initial acknowledgment comment.");
    }

    let replyMessage: string;
    if (prUrl) {
      replyMessage = `✅ @${triggeredBy}, I\'ve created/updated a pull request for you: ${prUrl}`;
    } else {
      replyMessage = `✅ @${triggeredBy}, I received your request, but no actionable changes were identified or no changes were necessary after running checks.`;
      logger.info("Replying that no changes were made or command was not actionable.");
    }

    if (isAppMentionOnPullRequestJob(job)) {
      await addCommentToPullRequest(octokit, {
        owner: originalRepoOwner,
        repo: originalRepoName,
        issue_number: eventNumber,
        body: replyMessage,
      });
    } else {
      await octokit.issues.createComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        issue_number: eventNumber,
        body: replyMessage,
      });
    }
    logger.info("Posted final reply comment.");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error }, "MentionJob handling failed.");

    if (initialCommentId) {
      try {
        await octokit.issues.deleteComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          comment_id: initialCommentId,
        });
        logger.info("Deleted initial acknowledgment comment during error handling.");
      } catch (deleteError) {
        logger.error({ deleteError }, "Failed to delete initial comment during error handling.");
      }
    }

    try {
      const errorMessageBody = `🚧 Oops, @${triggeredBy}! I encountered an error while working on your request.\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nPlease check the logs if you have access.`;
      if (isAppMentionOnPullRequestJob(job)) {
        await addCommentToPullRequest(octokit, {
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: eventNumber,
          body: errorMessageBody,
        });
      } else {
        await octokit.issues.createComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: eventNumber,
          body: errorMessageBody,
        });
      }
    } catch (commentError) {
      logger.error({ commentError }, "Failed to post error comment to GitHub.");
    }

    if (error instanceof JobError) {
      throw error;
    }
    throw new JobError(`Failed to handle MentionJob ${jobId}: ${errorMessage}`);
  } finally {
    if (repoPath && envConfig.CLEANUP_REPOSITORIES) {
      try {
        await cleanupRepository(repoPath);
        logger.info({ repoPath }, "Successfully cleaned up cloned repository.");
      } catch (cleanupError) {
        logger.error({ repoPath, error: cleanupError }, "Failed to cleanup cloned repository.");
      }
    }
    logger.info("Finished MentionJob handling.");
  }
}
