import { Octokit } from '@octokit/rest';
import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { getOctokitInstance } from './app';

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

/**
 * Add a comment to a pull request review comment.
 */
export const addCommentToPullRequest = async (
  owner: string,
  repo: string,
  pull_number: number,
  comment_id: number,
  body: string,
  installationId: number,
): Promise<void> => {
  try {
    const octokit = await getOctokitInstance(installationId);
    logger.info(
      {
        owner,
        repo,
        pull_number,
        comment_id,
      },
      'Adding comment to pull request review comment',
    );

    await octokit.pulls.createReviewComment({
      owner,
      repo,
      pull_number,
      comment_id,
      body,
    });

    logger.info(
      {
        owner,
        repo,
        pull_number,
        comment_id,
      },
      'Comment added to pull request review comment successfully',
    );
  } catch (error) {
    logger.error(
      {
        owner,
        repo,
        pull_number,
        comment_id,
        error,
      },
      'Failed to add comment to pull request review comment',
    );
    throw new GitHubError(
      `Failed to add comment to pull request review comment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
