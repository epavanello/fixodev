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
      await octokit.issues.addLabels({
        owner: params.owner,
        repo: params.repo,
        issue_number: response.data.number,
        labels: params.labels,
      });
    }

    // Add assignees if provided
    if (params.assignees && params.assignees.length > 0) {
      await octokit.issues.addAssignees({
        owner: params.owner,
        repo: params.repo,
        issue_number: response.data.number,
        assignees: params.assignees,
      });
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
 * Generate PR title and body based on the changes
 */
export const generatePRContent = (
  eventType: string,
  action: string,
  issueNumber?: number,
  commentBody?: string,
): { title: string; body: string } => {
  let title: string;
  let body: string;

  switch (eventType) {
    case 'issue_comment':
      title = `Fix: ${commentBody?.slice(0, 50)}${commentBody && commentBody.length > 50 ? '...' : ''}`;
      body = `This PR addresses the issue mentioned in #${issueNumber}.\n\n${commentBody}`;
      break;
    case 'pull_request':
      title = `Fix: Automated fixes for PR #${issueNumber}`;
      body = `This PR contains automated fixes for PR #${issueNumber}.`;
      break;
    default:
      title = 'Fix: Automated code improvements';
      body = 'This PR contains automated code improvements.';
  }

  return { title, body };
};
