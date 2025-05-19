import { isAppMentionJob, isUserMentionJob } from '../types/jobs';
import { ManagedJob } from '../queue/job';
import { BotConfig } from '../types/config';
import { logger as rootLogger } from '../config/logger';
import { GitHubApp } from '../github/app';
import { Octokit } from '@octokit/rest';
import { cloneRepository, cleanupRepository } from '../git/clone';
import { createBranch, commitChanges, pushChanges } from '../git/operations';
import { createPullRequest } from '../github/pr';
import { loadBotConfig } from '../utils/yaml';
import { JobError } from '../utils/error';
import { envConfig } from '../config/env';
import { ensureForkExists, ForkResult } from '../git/fork';
import { processCodeModificationRequest } from '@/llm/processor';
import { createTaskCompletionTool } from '@/llm/tools';

const handlerLogger = rootLogger.child({ context: 'MentionOnIssueJobHandler' });

export async function handleMentionOnIssueJob(job: ManagedJob): Promise<void> {
  const {
    id: jobId,
    originalRepoOwner,
    originalRepoName,
    eventIssueNumber,
    eventIssueTitle,
    commandToProcess,
    triggeredBy,
  } = job;

  const logger = handlerLogger.child({
    jobId,
    jobType: job.type,
    repo: `${originalRepoOwner}/${originalRepoName}`,
    issue: eventIssueNumber,
    triggeredBy,
  });

  logger.info('Starting MentionOnIssueJob handling.');

  let octokit: Octokit;
  let repoPath: string | undefined;
  let cloneToken: string | undefined;
  let repositoryToCloneUrl: string;
  let headBranchOwner: string = originalRepoOwner;

  if (isAppMentionJob(job)) {
    logger.info('Job identified as AppMention. Setting up GitHub App authentication.');
    const githubApp = new GitHubApp();
    octokit = await githubApp.getAuthenticatedClient(job.installationId);
    cloneToken = await githubApp.getInstallationToken(job.installationId);
    repositoryToCloneUrl = job.repositoryUrl;
    headBranchOwner = originalRepoOwner;
    logger.info('Successfully authenticated as GitHub App installation.');
  } else if (isUserMentionJob(job)) {
    logger.info('Job identified as UserMention. Setting up PAT authentication and forking.');
    if (!envConfig.BOT_USER_PAT || !envConfig.BOT_NAME) {
      logger.error('BOT_USER_PAT or BOT_NAME not configured for UserMentionOnIssueJob.');
      throw new JobError(
        'UserMentionOnIssueJob handler is not configured with BOT_USER_PAT or BOT_NAME.',
      );
    }
    octokit = new Octokit({ auth: envConfig.BOT_USER_PAT });
    cloneToken = envConfig.BOT_USER_PAT;
    headBranchOwner = envConfig.BOT_NAME;

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
  } else {
    throw new JobError(`Unknown job type for job ID ${jobId}`);
  }

  let initialCommentId: number | undefined;

  try {
    const initialComment = await octokit.issues.createComment({
      owner: originalRepoOwner,
      repo: originalRepoName,
      issue_number: eventIssueNumber,
      body: `👋 Hi @${triggeredBy}, I'm on it! I'll apply changes, and open a PR if needed. Stay tuned!`,
    });
    initialCommentId = initialComment.data.id;
    logger.info('Posted acknowledgment comment.');

    const cloneResult = await cloneRepository(repositoryToCloneUrl, undefined, cloneToken);
    repoPath = cloneResult.path;
    const git = cloneResult.git;
    logger.info({ repoPath }, 'Repository cloned successfully.');

    const botConfig = (await loadBotConfig(repoPath)) as BotConfig;
    logger.info({ botConfig }, 'Loaded bot configuration.');

    const branchName = `${envConfig.BOT_NAME}/${eventIssueNumber}-${Date.now().toString().slice(-6)}`;
    await createBranch(git, branchName);
    logger.info({ branchName }, 'Created new branch.');

    const modificationResult = await processCodeModificationRequest(
      commandToProcess,
      repoPath,
      botConfig,
      true,
      createTaskCompletionTool(),
    );
    logger.info({ modificationResult }, 'Result of applying command changes.');

    const status = await git.status();
    const hasPendingChanges = status.files.length > 0;
    logger.info(
      { hasPendingChanges, changedFileCount: status.files.length },
      'Checked repository status for changes.',
    );

    let prUrl: string | undefined;
    if (hasPendingChanges && modificationResult?.objectiveAchieved) {
      logger.info('Committing and pushing changes.');
      const commitMessage = `fix: Automated changes for ${originalRepoOwner}/${originalRepoName}#${eventIssueNumber} by @${envConfig.BOT_NAME}`;

      await commitChanges(git, commitMessage);
      await pushChanges(git, branchName);
      logger.info('Changes committed and pushed.');

      const pr = await createPullRequest(octokit, {
        owner: originalRepoOwner,
        repo: originalRepoName,
        title: `🤖 Fix for "${eventIssueTitle.slice(0, 40)}${eventIssueTitle.length > 40 ? '...' : ''}" by @${envConfig.BOT_NAME}`,
        head: `${headBranchOwner}:${branchName}`,
        base: botConfig.branches.target || 'main',
        body: `This PR addresses the mention of @${envConfig.BOT_NAME} in ${originalRepoOwner}/${originalRepoName}#${eventIssueNumber}.\n\nTriggered by: @${triggeredBy}`,
        labels: ['bot', envConfig.BOT_NAME.toLowerCase()],
      });
      prUrl = pr;
      logger.info({ prUrl }, 'Pull request created successfully.');
    } else {
      logger.info('No changes to commit. Skipping PR creation.');
    }

    if (initialCommentId) {
      await octokit.issues.deleteComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        comment_id: initialCommentId,
      });
      logger.info('Deleted initial acknowledgment comment.');
    }

    let replyMessage: string;
    if (prUrl) {
      replyMessage = `✅ @${triggeredBy}, I've created a pull request for you: ${prUrl}`;
    } else {
      replyMessage = `✅ @${triggeredBy}, I received your request, but no actionable changes were identified or no changes were necessary after running checks.`;
      logger.info('Replying that no changes were made or command was not actionable.');
    }
    await octokit.issues.createComment({
      owner: originalRepoOwner,
      repo: originalRepoName,
      issue_number: eventIssueNumber,
      body: replyMessage,
    });
    logger.info('Posted final reply comment.');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error }, 'MentionOnIssueJob handling failed.');

    if (initialCommentId) {
      try {
        await octokit.issues.deleteComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          comment_id: initialCommentId,
        });
        logger.info('Deleted initial acknowledgment comment during error handling.');
      } catch (deleteError) {
        logger.error({ deleteError }, 'Failed to delete initial comment during error handling.');
      }
    }

    try {
      await octokit.issues.createComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        issue_number: eventIssueNumber,
        body: `🚧 Oops, @${triggeredBy}! I encountered an error while working on your request.\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nPlease check the logs if you have access.`,
      });
    } catch (commentError) {
      logger.error({ commentError }, 'Failed to post error comment to GitHub issue.');
    }

    if (error instanceof JobError) {
      throw error;
    }
    throw new JobError(`Failed to handle MentionOnIssueJob ${jobId}: ${errorMessage}`);
  } finally {
    if (repoPath && envConfig.CLEANUP_REPOSITORIES) {
      try {
        await cleanupRepository(repoPath);
        logger.info({ repoPath }, 'Successfully cleaned up cloned repository.');
      } catch (cleanupError) {
        logger.error({ repoPath, error: cleanupError }, 'Failed to cleanup cloned repository.');
      }
    }
    logger.info('Finished MentionOnIssueJob handling.');
  }
}
