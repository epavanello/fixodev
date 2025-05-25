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

interface UpdatePRParams {
  owner: string;
  repo: string;
  pull_number: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  base?: string;
}

/**
 * Get a pull request by number
 */
export const getPullRequest = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  pull_number: number,
) => {
  try {
    logger.info({ owner, repo, pull_number }, 'Fetching pull request');
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number,
    });
    logger.info({ owner, repo, pull_number }, 'Pull request fetched successfully');
    return pr;
  } catch (error) {
    logger.error({ owner, repo, pull_number, error }, 'Failed to fetch pull request');
    throw new GitHubError(
      `Failed to fetch pull request: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

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
 * Update a pull request
 */
export const updatePullRequest = async (
  octokit: Octokit,
  params: UpdatePRParams,
): Promise<string> => {
  try {
    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pull_number,
      },
      'Updating pull request',
    );

    const response = await octokit.pulls.update({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pull_number,
      title: params.title,
      body: params.body,
      state: params.state,
      base: params.base,
    });

    logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        prNumber: response.data.number,
        prUrl: response.data.html_url,
      },
      'Pull request updated successfully',
    );
    return response.data.html_url;
  } catch (error) {
    logger.error(
      {
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pull_number,
        error,
      },
      'Failed to update pull request',
    );
    throw new GitHubError(
      `Failed to update pull request: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
