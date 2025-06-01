import { Octokit } from '@octokit/rest';
import { logger } from '../config/logger';
import { GitHubError } from '../utils/error';
import { defaultLogger } from '@/utils/logger';
import { PullRequest } from '@octokit/webhooks-types';
import { buildIssueContext, getIssue } from './issue';

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
 * Get a pull request by number
 */
export const getPullRequest = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequest> => {
  const response = await defaultLogger.execute(
    () =>
      octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      }),
    'get pull request',
    { owner, repo, prNumber },
  );

  return response.data as PullRequest;
};

/**
 * Get all comments for a pull request (issue comments)
 */
export const getPullRequestComments = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
) => {
  const response = await defaultLogger.execute(
    () =>
      octokit.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      }),
    'get pull request comments',
    { owner, repo, prNumber },
  );

  return response.data;
};

/**
 * Get the diff for a pull request
 */
export const getPullRequestDiff = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> => {
  const response = await defaultLogger.execute(
    () =>
      octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: {
          format: 'diff',
        },
      }),
    'get pull request diff',
    { owner, repo, prNumber },
  );

  return response.data as unknown as string;
};

/**
 * Extract linked issue number from PR body or title
 * Looks for patterns like "fixes #123", "closes #456", "addresses #789", etc.
 */
export const extractLinkedIssueNumber = (prBody: string, prTitle: string): number | null => {
  const text = `${prTitle} ${prBody}`.toLowerCase();

  // Common patterns for linking issues
  const patterns = [
    /(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved|address|addresses|addressed)\s+#(\d+)/gi,
    /(?:mention of @\w+ in #(\d+))/gi,
    /#(\d+)/g, // Fallback: any issue reference
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const issueNumber = parseInt(match[1], 10);
      if (!isNaN(issueNumber)) {
        return issueNumber;
      }
    }
  }

  return null;
};

/**
 * Build comprehensive context from a PR including title, description, comments, diff, and linked issue
 */
export const buildPullRequestContext = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  pullRequest: PullRequest,
  instructions?: string,
): Promise<string> => {
  // Get all comments for the PR
  const comments = await getPullRequestComments(octokit, owner, repo, pullRequest.number);

  // Get the diff for the PR
  const diff = await getPullRequestDiff(octokit, owner, repo, pullRequest.number);

  // Try to find linked issue
  let linkedIssueContext = '';
  const linkedIssueNumber = extractLinkedIssueNumber(
    pullRequest.body || '',
    pullRequest.title || '',
  );

  if (linkedIssueNumber) {
    try {
      const linkedIssue = await getIssue(
        octokit,
        `https://github.com/${owner}/${repo}/issues/${linkedIssueNumber}`,
      );
      linkedIssueContext = await buildIssueContext(octokit, owner, repo, linkedIssue);
    } catch (error) {
      defaultLogger.error('Failed to fetch linked issue context', error as Error, {
        owner,
        repo,
        prNumber: pullRequest.number,
        linkedIssueNumber,
      });
    }
  }

  // Prepare labels string
  let labelsString: string | undefined;
  if (pullRequest.labels && pullRequest.labels.length > 0) {
    const labelNames = pullRequest.labels
      .map(label => (typeof label === 'string' ? label : label.name))
      .filter(Boolean);
    if (labelNames.length > 0) {
      labelsString = labelNames.join(', ');
    }
  }

  // Import the generated prompt function
  const { generatePrUpdatePrompt } = await import('../llm/prompts/prompts');

  // Use the template to generate the context
  return await generatePrUpdatePrompt({
    owner,
    repo,
    prNumber: pullRequest.number.toString(),
    title: pullRequest.title,
    author: pullRequest.user?.login || 'unknown',
    state: pullRequest.state,
    createdAt: pullRequest.created_at,
    updatedAt:
      pullRequest.updated_at !== pullRequest.created_at ? pullRequest.updated_at : undefined,
    labels: labelsString,
    headBranch: pullRequest.head.ref,
    baseBranch: pullRequest.base.ref,
    body: pullRequest.body?.trim() || undefined,
    instructions: instructions?.trim() || undefined,
    comments: comments.map(comment => ({
      user: comment.user?.login || 'unknown',
      createdAt: comment.created_at,
      updatedAt: comment.updated_at !== comment.created_at ? comment.updated_at : undefined,
      body: comment.body?.trim() || undefined,
    })),
    diff,
    linkedIssueContext: linkedIssueContext || undefined,
  });
};
