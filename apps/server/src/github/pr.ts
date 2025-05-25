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
