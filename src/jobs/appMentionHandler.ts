import { AppMentionOnIssueJob } from '../types/jobs';
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
import { applyChangesFromCommand, performAutomatedFixesAndFormat } from './commonJobLogic';
import { envConfig } from '../config/env';

const handlerLogger = rootLogger.child({ context: 'AppMentionOnIssueJobHandler' });

export async function handleAppMentionOnIssueJob(
  job: AppMentionOnIssueJob & ManagedJob,
): Promise<void> {
  const {
    id: jobId,
    originalRepoOwner,
    originalRepoName,
    eventIssueNumber,
    eventIssueTitle,
    commandToProcess,
    installationId,
    repositoryUrl,
  } = job;
  const logger = handlerLogger.child({
    jobId,
    repo: `${originalRepoOwner}/${originalRepoName}`,
    issue: eventIssueNumber,
  });

  logger.info('Starting AppMentionOnIssueJob handling.');

  let octokit: Octokit | undefined = undefined;
  let repoPath: string | undefined;

  try {
    const githubApp = new GitHubApp();
    octokit = await githubApp.getAuthenticatedClient(installationId);
    const token = await githubApp.getInstallationToken(installationId);
    logger.info('Successfully authenticated as GitHub App installation.');

    const initialComment = await octokit.issues.createComment({
      owner: originalRepoOwner,
      repo: originalRepoName,
      issue_number: eventIssueNumber,
      body: `👋 Working on your request... I'll be back with an update soon!`,
    });
    logger.info('Posted acknowledgment comment.');

    const cloneResult = await cloneRepository(repositoryUrl, undefined, token);
    repoPath = cloneResult.path;
    const git = cloneResult.git;
    logger.info({ repoPath }, 'Repository cloned successfully.');

    const botConfig = (await loadBotConfig(repoPath)) as BotConfig;
    logger.info({ botConfig }, 'Loaded bot configuration.');

    const branchName = `ghbot/app/${jobId.substring(0, 12)}/${eventIssueNumber}`;
    await createBranch(git, branchName);
    logger.info({ branchName }, 'Created new branch.');

    const filesChangedByCommand = await applyChangesFromCommand(
      commandToProcess,
      repoPath,
      botConfig,
      jobId,
      logger,
    );
    logger.info({ filesChangedByCommand }, 'Result of applying command changes.');

    const filesChangedByAutomation = await performAutomatedFixesAndFormat(
      repoPath,
      botConfig,
      jobId,
      logger,
    );
    logger.info({ filesChangedByAutomation }, 'Result of automated fixes and formatting.');

    const status = await git.status();
    const hasPendingChanges = status.files.length > 0;
    logger.info(
      { hasPendingChanges, changedFileCount: status.files.length },
      'Checked repository status for changes.',
    );

    let prUrl: string | undefined;
    if (hasPendingChanges) {
      logger.info('Committing and pushing changes.');
      const commitMessage = `fix: Automated changes for #${eventIssueNumber} by ${envConfig.BOT_NAME}`;
      await commitChanges(git, commitMessage);
      await pushChanges(git, branchName);
      logger.info('Changes committed and pushed.');

      const prDataOrUrl = await createPullRequest(octokit, {
        owner: originalRepoOwner,
        repo: originalRepoName,
        title: `🤖 Fix for "${eventIssueTitle.slice(0, 40)}${eventIssueTitle.length > 40 ? '...' : ''}"`,
        head: branchName,
        base: botConfig.branches.target || 'main',
        body: `This PR addresses issue #${eventIssueNumber} based on your command.\n\nJob ID: ${jobId}\nTriggered by: @${job.triggeredBy}`,
        labels: ['bot', envConfig.BOT_NAME.toLowerCase()],
      });
      prUrl = prDataOrUrl;
      logger.info({ prUrl }, 'Pull request created successfully.');
    } else {
      logger.info('No changes to commit. Skipping PR creation.');
    }

    if (octokit && initialComment?.data?.id) {
      await octokit.issues.deleteComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        comment_id: initialComment.data.id,
      });
    }

    let replyMessage: string;
    if (prUrl) {
      replyMessage = `✅ I've created a pull request for you: ${prUrl}`;
    } else if (filesChangedByCommand || filesChangedByAutomation) {
      replyMessage =
        "I've processed your request and applied some changes directly or ensured everything is in order. No new pull request was needed.";
      logger.info('Replying that changes were made/checked, but no PR created.');
    } else {
      replyMessage =
        'I received your request, but no actionable changes were identified or no changes were necessary after running checks.';
      logger.info('Replying that no changes were made or command was not actionable.');
    }
    if (octokit) {
      await octokit.issues.createComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        issue_number: eventIssueNumber,
        body: replyMessage,
      });
      logger.info('Posted final reply comment.');
    }
  } catch (error: any) {
    logger.error(
      { error: error.message, stack: error.stack },
      'AppMentionOnIssueJob handling failed.',
    );
    if (octokit && originalRepoOwner && originalRepoName && eventIssueNumber) {
      try {
        await octokit.issues.createComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: eventIssueNumber,
          body: `🚧 Oops! I encountered an error while processing your request.\n\n\`\`\`\n${error.message}\n\`\`\`\n\nPlease check the logs for more details.`,
        });
      } catch (commentError: any) {
        logger.error(
          { commentError: commentError.message },
          'Failed to post error comment to GitHub issue.',
        );
      }
    }
    throw new JobError(`Failed to handle AppMentionOnIssueJob ${jobId}: ${error.message}`);
  } finally {
    if (repoPath && envConfig.CLEANUP_REPOSITORIES) {
      try {
        await cleanupRepository(repoPath);
        logger.info({ repoPath }, 'Successfully cleaned up repository.');
      } catch (cleanupError) {
        logger.error({ repoPath, error: cleanupError }, 'Failed to cleanup repository.');
      }
    }
    logger.info('Finished AppMentionOnIssueJob handling.');
  }
}
