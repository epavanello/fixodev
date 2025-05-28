import { SimpleGit } from 'simple-git';
import { GitHubError } from '../utils/error';
import { defaultLogger } from '../utils/logger';
import { envConfig } from '../config/env';

const gitLogger = defaultLogger.child({ module: 'git-operations' });

/**
 * Create a new branch and switch to it
 */
export const createBranch = async (git: SimpleGit, branchName: string): Promise<void> => {
  const operationLogger = gitLogger.child({ operation: 'create-branch', branchName });

  // Check if branch already exists
  const branches = await operationLogger.execute(() => git.branch(), 'get branch list');

  if (branches.all.includes(branchName)) {
    throw new GitHubError(`Branch ${branchName} already exists`);
  }

  // Create and checkout new branch
  await operationLogger.execute(
    () => git.checkoutLocalBranch(branchName),
    'create and checkout branch',
  );
};

/**
 * Stage and commit changes
 */
export const commitChanges = async (git: SimpleGit, message: string): Promise<void> => {
  const operationLogger = gitLogger.child({ operation: 'commit-changes', commitMessage: message });

  // Configure Git identity for the GitHub App
  await operationLogger.execute(
    () => git.addConfig('user.name', envConfig.GIT_BOT_USERNAME),
    'configure git username',
    { username: envConfig.GIT_BOT_USERNAME },
  );

  await operationLogger.execute(
    () => git.addConfig('user.email', envConfig.GIT_BOT_EMAIL),
    'configure git email',
    { email: envConfig.GIT_BOT_EMAIL },
  );

  // Stage all changes
  await operationLogger.execute(() => git.add('.'), 'stage all changes');

  // Check if there are any changes to commit
  const status = await operationLogger.execute(() => git.status(), 'check git status');

  if (status.modified.length === 0 && status.created.length === 0 && status.deleted.length === 0) {
    operationLogger.info('No changes to commit', {
      modified: status.modified.length,
      created: status.created.length,
      deleted: status.deleted.length,
    });
    return;
  }

  // Commit changes
  await operationLogger.execute(() => git.commit(message), 'commit changes', {
    changesCount: status.modified.length + status.created.length + status.deleted.length,
    modified: status.modified.length,
    created: status.created.length,
    deleted: status.deleted.length,
  });
};

/**
 * Push changes to remote repository
 */
export const pushChanges = async (git: SimpleGit, branchName: string): Promise<void> => {
  const operationLogger = gitLogger.child({ operation: 'push-changes', branchName });

  // Push to remote
  await operationLogger.execute(() => git.push('origin', branchName), 'push changes to remote', {
    remote: 'origin',
  });
};
