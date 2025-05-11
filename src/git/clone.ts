import simpleGit, { SimpleGit } from 'simple-git';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../config/logger';

// Base directory for cloned repositories
const REPOS_DIR = join(process.cwd(), 'repos');

/**
 * Clone a repository to a local path
 */
export const cloneRepository = async (
  repoUrl: string,
  branch?: string,
): Promise<{ path: string; git: SimpleGit }> => {
  try {
    // Create repos directory if it doesn't exist
    if (!existsSync(REPOS_DIR)) {
      await mkdir(REPOS_DIR, { recursive: true });
    }

    // Generate a unique directory name for this clone
    const repoId = Buffer.from(repoUrl).toString('base64').replace(/[/+=]/g, '_');
    const timestamp = Date.now();
    const cloneDir = join(REPOS_DIR, `${repoId}_${timestamp}`);

    logger.info({ repoUrl, cloneDir }, 'Cloning repository');

    // Initialize git client
    const git = simpleGit();

    // Clone options
    const options = ['--depth=1'];
    if (branch) {
      options.push('--branch', branch);
    }

    // Clone repository
    await git.clone(repoUrl, cloneDir, options);

    // Change working directory
    const localGit = simpleGit(cloneDir);

    logger.info({ repoUrl, cloneDir }, 'Repository cloned successfully');

    return {
      path: cloneDir,
      git: localGit,
    };
  } catch (error) {
    logger.error({ repoUrl, error }, 'Failed to clone repository');
    throw new Error(
      `Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Clean up a cloned repository
 */
export const cleanupRepository = async (repoPath: string): Promise<void> => {
  try {
    if (existsSync(repoPath)) {
      await rm(repoPath, { recursive: true, force: true });
      logger.info({ repoPath }, 'Repository directory cleaned up');
    }
  } catch (error) {
    logger.error({ repoPath, error }, 'Failed to clean up repository directory');
  }
};
