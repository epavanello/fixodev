import { GitHubApp } from '../github/app';
import { Octokit } from '@octokit/rest';
import { JobError } from '../utils/error';
import { OperationLogger } from '@/utils/logger';
import { envConfig } from '../config/env';
import { ensureForkExists } from '../git/fork';
import { RateLimitManager } from '../utils/rateLimit';

export interface AuthenticationResult {
  octokit: Octokit;
  cloneToken: string;
  repositoryToCloneUrl: string;
  headBranchOwner: string;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  triggeredByCheck: any;
  repoOwnerCheck: any;
}

/**
 * Handle authentication for both GitHub App and user PAT
 */
export async function handleAuthentication(
  installationId: number | undefined,
  originalRepoOwner: string,
  originalRepoName: string,
  repoUrl: string,
  jobLogger: OperationLogger,
): Promise<AuthenticationResult> {
  let octokit: Octokit;
  let cloneToken: string;
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
      throw new JobError('Job handler is not configured with BOT_USER_PAT or BOT_NAME.');
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

  return {
    octokit,
    cloneToken,
    repositoryToCloneUrl,
    headBranchOwner,
  };
}

/**
 * Check rate limits for both triggeredBy and repoOwner
 */
export async function checkRateLimits(
  rateLimitManager: RateLimitManager,
  triggeredBy: string,
  originalRepoOwner: string,
  jobLogger: OperationLogger,
): Promise<RateLimitCheckResult> {
  const [triggeredByCheck, repoOwnerCheck] = await jobLogger.execute(
    () =>
      Promise.all([
        rateLimitManager.checkRateLimit(triggeredBy, 'triggeredBy'),
        rateLimitManager.checkRateLimit(originalRepoOwner, 'repoOwner'),
      ]),
    'check rate limits',
    { triggeredBy, repoOwner: originalRepoOwner },
  );

  const allowed = triggeredByCheck.allowed && repoOwnerCheck.allowed;

  return {
    allowed,
    triggeredByCheck,
    repoOwnerCheck,
  };
}

/**
 * Handle rate limit exceeded scenario
 */
export async function handleRateLimitExceeded(
  rateLimitManager: RateLimitManager,
  triggeredBy: string,
  triggeredByCheck: any,
  repoOwnerCheck: any,
  octokit: Octokit,
  originalRepoOwner: string,
  originalRepoName: string,
  issueOrPrNumber: number,
  testJob: boolean | undefined,
  jobLogger: OperationLogger,
): Promise<void> {
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
          issue_number: issueOrPrNumber,
          body: rateLimitMessage,
        }),
      'post rate limit exceeded message',
      { limitExceededUser, limitExceededUserType, reason: limitExceededCheck.reason },
    );
  }
}

/**
 * Post initial acknowledgment comment
 */
export async function postInitialComment(
  octokit: Octokit,
  originalRepoOwner: string,
  originalRepoName: string,
  issueOrPrNumber: number,
  triggeredBy: string,
  message: string,
  testJob: boolean | undefined,
  jobLogger: OperationLogger,
): Promise<number | undefined> {
  if (testJob) {
    return undefined;
  }

  const initialComment = await jobLogger.execute(
    () =>
      octokit.issues.createComment({
        owner: originalRepoOwner,
        repo: originalRepoName,
        issue_number: issueOrPrNumber,
        body: message,
      }),
    'post acknowledgment comment',
  );

  return initialComment.data.id;
}

/**
 * Clean up initial comment
 */
export async function cleanupInitialComment(
  octokit: Octokit,
  originalRepoOwner: string,
  originalRepoName: string,
  initialCommentId: number,
  testJob: boolean | undefined,
  jobLogger: OperationLogger,
): Promise<void> {
  if (initialCommentId && !testJob) {
    await jobLogger.safe(
      () =>
        octokit.issues.deleteComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          comment_id: initialCommentId,
        }),
      'delete initial acknowledgment comment',
      { initialCommentId },
    );
  }
}

/**
 * Post final reply comment
 */
export async function postFinalComment(
  octokit: Octokit,
  originalRepoOwner: string,
  originalRepoName: string,
  issueOrPrNumber: number,
  message: string,
  testJob: boolean | undefined,
  jobLogger: OperationLogger,
  metadata?: Record<string, any>,
): Promise<void> {
  if (!testJob) {
    await jobLogger.execute(
      () =>
        octokit.issues.createComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: issueOrPrNumber,
          body: message,
        }),
      'post final reply comment',
      metadata,
    );
  }
}

/**
 * Post error comment
 */
export async function postErrorComment(
  octokit: Octokit,
  originalRepoOwner: string,
  originalRepoName: string,
  issueOrPrNumber: number,
  triggeredBy: string,
  error: Error | unknown,
  testJob: boolean | undefined,
  jobLogger: OperationLogger,
): Promise<void> {
  if (!testJob) {
    await jobLogger.safe(
      () =>
        octokit.issues.createComment({
          owner: originalRepoOwner,
          repo: originalRepoName,
          issue_number: issueOrPrNumber,
          body: `🚧 Oops, @${triggeredBy}! I encountered an error while working on your request.\n\n\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\`\n\nPlease check the logs if you have access.`,
        }),
      'post error comment',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}
