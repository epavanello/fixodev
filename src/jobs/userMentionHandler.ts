import { UserMentionOnIssueJob } from '../types/jobs';
import { ManagedJob } from '../queue/job';
import { BotConfig } from '../types/config';
import { logger as rootLogger } from '../config/logger';
import { Octokit } from '@octokit/rest';
import { cloneRepository, cleanupRepository } from '../git/clone';
import { createBranch, commitChanges, pushChanges } from '../git/operations';
import { createPullRequest } from '../github/pr';
import { loadBotConfig } from '../utils/yaml';
import { JobError } from '../utils/error';
import { applyChangesFromCommand, performAutomatedFixesAndFormat } from './commonJobLogic';
import { envConfig } from '../config/env';

const handlerLogger = rootLogger.child({ context: 'UserMentionOnIssueJobHandler' });

export async function handleUserMentionOnIssueJob(
  job: UserMentionOnIssueJob & ManagedJob,
): Promise<void> {
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
    repo: `${originalRepoOwner}/${originalRepoName}`,
    issue: eventIssueNumber,
  });

  logger.info('Starting UserMentionOnIssueJob handling.');

  if (!envConfig.BOT_USER_PAT || !envConfig.BOT_NAME) {
    logger.error('BOT_USER_PAT or BOT_NAME not configured for UserMentionOnIssueJob.');
    throw new JobError(
      'UserMentionOnIssueJob handler is not configured with BOT_USER_PAT or BOT_NAME.',
    );
  }

  let octokit: Octokit | undefined = undefined;
  let repoPath: string | undefined;
  let forkOwner = envConfig.BOT_NAME;
  let forkRepoName = originalRepoName;
  let forkUrl: string;

  try {
    octokit = new Octokit({ auth: envConfig.BOT_USER_PAT });
    logger.info(`Successfully authenticated as user @${forkOwner}.`);

    // Check if fork exists, create if not
    try {
      logger.info(`Checking if fork ${forkOwner}/${forkRepoName} exists.`);
      const forkCheckResponse = await octokit.repos.get({
        owner: forkOwner,
        repo: forkRepoName,
      });
      forkUrl = forkCheckResponse.data.clone_url;
      logger.info(`Fork ${forkOwner}/${forkRepoName} already exists at ${forkUrl}.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && 'status' in error && error.status === 404) {
        logger.info(`Fork ${forkOwner}/${forkRepoName} does not exist. Creating fork...`);
        const createForkResponse = await octokit.repos.createFork({
          owner: originalRepoOwner,
          repo: originalRepoName,
        });
        forkUrl = createForkResponse.data.clone_url;
        forkOwner = createForkResponse.data.owner.login; // This confirms the fork owner
        forkRepoName = createForkResponse.data.name;
        logger.info(
          `Successfully forked ${originalRepoOwner}/${originalRepoName} to ${forkOwner}/${forkRepoName} at ${forkUrl}.`,
        );
        // GitHub might take a few moments to make the fork fully available for cloning
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay
      } else {
        logger.error({ error: error }, `Failed to check/create fork.`);
        throw new JobError(
          `Failed to ensure fork exists for ${originalRepoOwner}/${originalRepoName}: ${errorMessage}`,
        );
      }
    }

    const initialComment = await octokit.issues.createComment({
      owner: originalRepoOwner,
      repo: originalRepoName,
      issue_number: eventIssueNumber,
      body: `👋 Hi @${triggeredBy}, I'm @${envConfig.BOT_NAME} and I'm on it! I'll fork the repo, apply changes, and open a PR. Stay tuned!`,
    });
    logger.info('Posted acknowledgment comment.');

    // Clone the fork
    const cloneResult = await cloneRepository(forkUrl, undefined, envConfig.BOT_USER_PAT);
    repoPath = cloneResult.path;
    const git = cloneResult.git;
    logger.info({ repoPath }, 'Forked repository cloned successfully.');

    const botConfig = (await loadBotConfig(repoPath)) as BotConfig;
    logger.info({ botConfig }, 'Loaded bot configuration from fork.');

    const branchName = `${envConfig.BOT_NAME}/${eventIssueNumber}`;
    await createBranch(git, branchName);
    logger.info({ branchName }, 'Created new branch on fork.');

    const filesChangedByCommand = await applyChangesFromCommand(
      commandToProcess,
      repoPath,
      botConfig,
      jobId,
      logger,
    );
    logger.info({ filesChangedByCommand }, 'Result of applying command changes to fork.');

    const filesChangedByAutomation = await performAutomatedFixesAndFormat(
      repoPath,
      botConfig,
      jobId,
      logger,
    );
    logger.info({ filesChangedByAutomation }, 'Result of automated fixes and formatting on fork.');

    const status = await git.status();
    const hasPendingChanges = status.files.length > 0;
    logger.info(
      { hasPendingChanges, changedFileCount: status.files.length },
      'Checked fork status for changes.',
    );

    let prUrl: string | undefined;
    if (hasPendingChanges) {
      logger.info('Committing and pushing changes to fork.');
      const commitMessage = `fix: Automated changes for ${originalRepoOwner}/${originalRepoName}#${eventIssueNumber} by @${envConfig.BOT_NAME}`;
      await commitChanges(git, commitMessage); // commitChanges should use BOT_NAME and email from env
      await pushChanges(git, branchName);
      logger.info('Changes committed and pushed to fork.');

      const pr = await createPullRequest(octokit, {
        owner: originalRepoOwner, // PR to original repo
        repo: originalRepoName,
        title: `🤖 Fix for "${eventIssueTitle.slice(0, 40)}${eventIssueTitle.length > 40 ? '...' : ''}" by @${envConfig.BOT_NAME}`,
        head: `${forkOwner}:${branchName}`, // Head is from the fork
        base: botConfig.branches.target || 'main', // Base on original repo
        body: `This PR addresses the mention of @${envConfig.BOT_NAME} in ${originalRepoOwner}/${originalRepoName}#${eventIssueNumber}.\n\nChanges implemented by @${envConfig.BOT_NAME} via job ${jobId}.\nTriggered by: @${job.triggeredBy}`,
        labels: ['bot-contribution', envConfig.BOT_NAME.toLowerCase()],
      });
      prUrl = pr; // createPullRequest returns the html_url string directly
      logger.info({ prUrl }, 'Pull request created successfully from fork.');
    } else {
      logger.info('No changes to commit on fork. Skipping PR creation.');
    }

    await octokit.issues.deleteComment({
      owner: originalRepoOwner,
      repo: originalRepoName,
      comment_id: initialComment.data.id,
    });

    let replyMessage: string;
    if (prUrl) {
      replyMessage = `✅ @${triggeredBy}, I've created a pull request for you from my fork: ${prUrl}`;
    } else if (filesChangedByCommand || filesChangedByAutomation) {
      replyMessage = `@${triggeredBy}, I've processed your request. Some changes were applied to my fork, but no further pull request was needed (perhaps formatting or minor fixes).`;
      logger.info('Replying that changes were made to fork, but no PR created.');
    } else {
      replyMessage = `@${triggeredBy}, I received your request, but no actionable changes were identified or no changes were necessary after running checks on my fork.`;
      logger.info('Replying that no changes were made to fork or command was not actionable.');
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
    logger.error({ error: error }, 'UserMentionOnIssueJob handling failed.');
    if (octokit && originalRepoOwner && originalRepoName && eventIssueNumber) {
      try {
        await octokit.issues.createComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: eventIssueNumber,
          body: `🚧 Oops, @${triggeredBy}! I encountered an error while working on your request.\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nI, @${envConfig.BOT_NAME}, will try to improve. Please check logs if you have access.`,
        });
      } catch (commentError) {
        logger.error(
          { commentError: commentError },
          'Failed to post error comment to GitHub issue.',
        );
      }
    }
    throw new JobError(`Failed to handle UserMentionOnIssueJob ${jobId}: ${error}`);
  } finally {
    if (repoPath && envConfig.CLEANUP_REPOSITORIES) {
      try {
        await cleanupRepository(repoPath); // Cleans up the cloned fork
        logger.info({ repoPath }, 'Successfully cleaned up forked repository clone.');
      } catch (cleanupError) {
        logger.error(
          { repoPath, error: cleanupError },
          'Failed to cleanup forked repository clone.',
        );
      }
    }
    logger.info('Finished UserMentionOnIssueJob handling.');
  }
}
