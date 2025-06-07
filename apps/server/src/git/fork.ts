import { Octokit } from '@octokit/rest';
import { JobError } from '../utils/error';
import { defaultLogger } from '../utils/logger';

const forkLogger = defaultLogger.child({ module: 'git-fork' });

export interface ForkResult {
  forkOwner: string;
  forkRepoName: string;
  forkCloneUrl: string;
  wasSynced?: boolean;
}

/**
 * Ensures a fork of the specified repository exists for the authenticated user/app,
 * creating it if necessary. If the fork already exists, it will be synchronized with upstream.
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
  let wasSynced = false;

  const operationLogger = forkLogger.child({
    originalRepo: `${originalRepoOwner}/${originalRepoName}`,
    desiredForkOwner,
  });

  // First, try to check if fork already exists
  const forkCheckResult = await operationLogger.safe(
    () =>
      octokit.repos.get({
        owner: forkOwner,
        repo: forkRepoName,
      }),
    'check if fork exists',
    { forkRepo: `${forkOwner}/${forkRepoName}` },
  );

  if (forkCheckResult.ok) {
    // Fork already exists, try to sync it with upstream
    forkCloneUrl = forkCheckResult.data.data.clone_url;

    const syncResult = await operationLogger.safe(
      () =>
        octokit.repos.mergeUpstream({
          owner: forkOwner,
          repo: forkRepoName,
          branch: forkCheckResult.data.data.default_branch || 'main',
        }),
      'sync fork with upstream',
      {
        forkRepo: `${forkOwner}/${forkRepoName}`,
        upstream: `${originalRepoOwner}/${originalRepoName}`,
      },
    );

    if (syncResult.ok) {
      wasSynced = true;
      operationLogger.info('Fork successfully synced with upstream', {
        mergeType: syncResult.data.data.merge_type,
        baseBranch: syncResult.data.data.base_branch,
      });
    } else {
      // Sync failed, log the error but continue - the fork still exists
      operationLogger.warn('Failed to sync fork with upstream, continuing with existing fork', {
        error: syncResult.error.message,
        status: 'status' in syncResult.error ? syncResult.error.status : 'unknown',
      });
    }

    return { forkOwner, forkRepoName, forkCloneUrl, wasSynced };
  }

  // Check if it's a 404 (fork doesn't exist) or another error
  const error = forkCheckResult.error;
  if (!('status' in error) || error.status !== 404) {
    // It's not a 404, so it's a real error
    throw new JobError(`Failed to check for fork ${forkOwner}/${forkRepoName}: ${error.message}`);
  }

  // Fork doesn't exist, create it
  const createForkResponse = await operationLogger.execute(
    () =>
      octokit.repos.createFork({
        owner: originalRepoOwner,
        repo: originalRepoName,
      }),
    'create fork',
    { targetFork: `${forkOwner}/${forkRepoName}` },
  );

  forkCloneUrl = createForkResponse.data.clone_url;
  forkOwner = createForkResponse.data.owner.login;
  forkRepoName = createForkResponse.data.name;

  // Wait for fork to become available
  await operationLogger.execute(
    () => new Promise(resolve => setTimeout(resolve, 5000)),
    'wait for fork to become available',
    { waitTimeMs: 5000, finalFork: `${forkOwner}/${forkRepoName}` },
  );

  return { forkOwner, forkRepoName, forkCloneUrl, wasSynced: true };
}
