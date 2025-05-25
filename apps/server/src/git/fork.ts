import { Octokit } from '@octokit/rest';
import { logger as rootLogger } from '../config/logger';
import { JobError } from '../utils/error';

const logger = rootLogger.child({ context: 'GitFork' });

export interface ForkResult {
  forkOwner: string;
  forkRepoName: string;
  forkCloneUrl: string;
}

/**
 * Ensures a fork of the specified repository exists for the authenticated user/app,
 * creating it if necessary.
 *
 * @param octokit Authenticated Octokit instance.
 * @param originalRepoOwner The owner of the original repository.
 * @param originalRepoName The name of the original repository.
 * @param desiredForkOwner The user/org that should own the fork (e.g., the bot's username).
 * @returns {Promise<ForkResult>} Details of the fork.
 */
export async function ensureForkExists(
  octokit: Octokit,
  originalRepoOwner: string,
  originalRepoName: string,
  desiredForkOwner: string,
): Promise<ForkResult> {
  let forkOwner = desiredForkOwner;
  let forkRepoName = originalRepoName;
  let forkCloneUrl: string;

  try {
    logger.info(`Checking if fork ${forkOwner}/${forkRepoName} exists.`);
    const forkCheckResponse = await octokit.repos.get({
      owner: forkOwner,
      repo: forkRepoName,
    });
    forkCloneUrl = forkCheckResponse.data.clone_url;
    logger.info(`Fork ${forkOwner}/${forkRepoName} already exists at ${forkCloneUrl}.`);
    return { forkOwner, forkRepoName, forkCloneUrl };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && 'status' in error && error.status === 404) {
      logger.info(`Fork ${forkOwner}/${forkRepoName} does not exist. Creating fork...`);
      try {
        const createForkResponse = await octokit.repos.createFork({
          owner: originalRepoOwner,
          repo: originalRepoName,
          // organization: if bot is part of an org and needs to fork there, this might be needed
        });
        forkCloneUrl = createForkResponse.data.clone_url;
        // The owner of the fork might differ from desiredForkOwner if forking to an org the user is part of
        forkOwner = createForkResponse.data.owner.login;
        forkRepoName = createForkResponse.data.name; // Name usually stays the same
        logger.info(
          `Successfully forked ${originalRepoOwner}/${originalRepoName} to ${forkOwner}/${forkRepoName} at ${forkCloneUrl}.`,
        );
        // GitHub might take a few moments to make the fork fully available for cloning
        logger.info('Waiting for 5 seconds for the fork to become available...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay
        return { forkOwner, forkRepoName, forkCloneUrl };
      } catch (forkError) {
        const forkErrorMessage = forkError instanceof Error ? forkError.message : String(forkError);
        logger.error({ error: forkError }, `Failed to create fork.`);
        throw new JobError(
          `Failed to create fork ${desiredForkOwner}/${originalRepoName} from ${originalRepoOwner}/${originalRepoName}: ${forkErrorMessage}`,
        );
      }
    } else {
      logger.error({ error: error }, `Failed to check for fork ${forkOwner}/${forkRepoName}.`);
      throw new JobError(`Failed to check for fork ${forkOwner}/${forkRepoName}: ${errorMessage}`);
    }
  }
}
