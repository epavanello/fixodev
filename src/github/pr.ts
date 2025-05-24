import { Octokit } from '@octokit/rest';
import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';

interface CreatePRParams {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}

interface AddCommentParams {
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}

/**
 * Create a pull request
 */
export const createPullRequest = async (
  octokit: Octokit,
  params: CreatePRParams,
): Promise<string> => {
  try {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        head: params.head,
        base: params.base,
      },
      'Creating pull request',
    );

    // Create PR
    const response = await octokit.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      head: params.head,
      base: params.base,
      body: params.body,
    });

    // Add labels if provided
    if (params.labels && params.labels.length > 0) {
      try {
        await octokit.issues.addLabels({
          owner: params.owner,
          repo: params.repo,
          issue_number: response.data.number,
          labels: params.labels,
        });
      } catch (error) {
        logger.error({ error: error }, 'Failed to add labels to pull request');
      }
    }

    // Add assignees if provided
    if (params.assignees && params.assignees.length > 0) {
      try {
        await octokit.issues.addAssignees({
          owner: params.owner,
          repo: params.repo,
          issue_number: response.data.number,
          assignees: params.assignees,
        });
      } catch (error) {
        logger.error({ error: error }, 'Failed to add assignees to pull request');
      }
    }

    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        prNumber: response.data.number,
        prUrl: response.data.html_url,
      },
      'Pull request created successfully',
    );
    return response.data.html_url;
  } catch (error) {
    logger.error(
      {
        owner: params.owner,
        repo: params.repo,
        error,
      },
      'Failed to create pull request',
    );
    throw new GitHubError(
      `Failed to create pull request: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Add a comment to a pull request
 */
export const addCommentToPullRequest = async (
  octokit: Octokit,
  params: AddCommentParams,
): Promise<void> => {
  try {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issue_number,
      },
      'Adding comment to pull request',
    );
    await octokit.issues.createComment({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issue_number,
      body: params.body,
    });
    logger.info('Comment added to pull request successfully');
  } catch (error) {
    logger.error(
      {
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issue_number,
        error,
      },
      'Failed to add comment to pull request',
    );
    throw new GitHubError(
      `Failed to add comment to pull request: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Get a pull request by its number
 */
export const getPullRequest = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  pull_number: number,
) => {
  try {
    logger.info({ owner, repo, pull_number }, 'Fetching pull request');
    const { data: pullRequest } = await octokit.pulls.get({
      owner,
      repo,
      pull_number,
    });
    logger.info({ owner, repo, pull_number }, 'Pull request fetched successfully');
    return pullRequest;
  } catch (error) {
    logger.error({ owner, repo, pull_number, error }, 'Failed to fetch pull request');
    throw new GitHubError(
      `Failed to fetch pull request: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
