import { SimpleGit } from 'simple-git';
import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { envConfig } from '../config/env';

/**
 * Create a new branch and switch to it
 */
export const createBranch = async (git: SimpleGit, branchName: string): Promise<void> => {
  try {
    logger.info({ branchName }, 'Creating new branch');

    // Check if branch already exists
    const branches = await git.branch();
    if (branches.all.includes(branchName)) {
      throw new GitHubError(`Branch ${branchName} already exists`);
    }

    // Create and checkout new branch
    await git.checkoutLocalBranch(branchName);

    logger.info({ branchName }, 'Branch created successfully');
  } catch (error) {
    logger.error({ branchName, error }, 'Failed to create branch');
    throw new GitHubError(
      `Failed to create branch: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Stage and commit changes
 */
export const commitChanges = async (git: SimpleGit, message: string): Promise<void> => {
  try {
    logger.info('Committing changes');

    // Configure Git identity for the GitHub App
    await git.addConfig('user.name', envConfig.GIT_BOT_USERNAME);
    await git.addConfig('user.email', envConfig.GIT_BOT_EMAIL);

    // Stage all changes
    await git.add('.');

    // Check if there are any changes to commit
    const status = await git.status();
    if (
      status.modified.length === 0 &&
      status.created.length === 0 &&
      status.deleted.length === 0
    ) {
      logger.info('No changes to commit');
      return;
    }

    // Commit changes
    await git.commit(message);

    logger.info('Changes committed successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to commit changes');
    throw new GitHubError(
      `Failed to commit changes: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Push changes to remote repository
 */
export const pushChanges = async (git: SimpleGit, branchName: string): Promise<void> => {
  try {
    logger.info({ branchName }, 'Pushing changes');

    // Push to remote
    await git.push('origin', branchName);

    logger.info({ branchName }, 'Changes pushed successfully');
  } catch (error) {
    logger.error({ branchName, error }, 'Failed to push changes');
    throw new GitHubError(
      `Failed to push changes: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
