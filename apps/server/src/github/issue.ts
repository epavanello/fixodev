import { Octokit } from '@octokit/rest';
import { Issue } from '@octokit/webhooks-types';
import { parseGitHubIssueUrl } from '../utils/github';
import { defaultLogger } from '@/utils/logger';
import { generateIssuePrompt } from '../llm/prompts/prompts';

/**
 * Fetch a GitHub issue by URL
 */
export const getIssue = async (octokit: Octokit, issueUrl: string): Promise<Issue> => {
  const { owner, repo, issueNumber } = parseGitHubIssueUrl(issueUrl);

  const response = await defaultLogger.execute(
    () =>
      octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      }),
    'get issue',
    { issueUrl },
  );

  return response.data as Issue;
};

/**
 * Fetch all comments for a GitHub issue
 */
export const getIssueComments = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
) => {
  const response = await defaultLogger.execute(
    () =>
      octokit.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100, // Get up to 100 comments
      }),
    'get issue comments',
    { owner, repo, issueNumber },
  );

  return response.data;
};

/**
 * Build comprehensive context from an issue including title, description, and comments
 */
export const buildIssueContext = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  issue: Issue,
): Promise<string> => {
  // Get all comments for the issue
  const comments = await getIssueComments(octokit, owner, repo, issue.number);

  // Prepare labels string
  let labelsString: string | undefined;
  if (issue.labels && issue.labels.length > 0) {
    const labelNames = issue.labels
      .map(label => (typeof label === 'string' ? label : label.name))
      .filter(Boolean);
    if (labelNames.length > 0) {
      labelsString = labelNames.join(', ');
    }
  }

  // Prepare assignees string
  let assigneesString: string | undefined;
  if (issue.assignees && issue.assignees.length > 0) {
    assigneesString = issue.assignees.map(assignee => `@${assignee.login}`).join(', ');
  }

  // Generate the context using the template
  return await generateIssuePrompt({
    owner,
    repo,
    issueNumber: issue.number.toString(),
    title: issue.title,
    author: issue.user?.login || 'unknown',
    state: issue.state || 'unknown',
    createdAt: issue.created_at,
    updatedAt: issue.updated_at !== issue.created_at ? issue.updated_at : undefined,
    labels: labelsString,
    assignees: assigneesString,
    body: issue.body?.trim() || undefined,
    comments: comments.map(comment => ({
      user: comment.user?.login || 'unknown',
      createdAt: comment.created_at,
      updatedAt: comment.updated_at !== comment.created_at ? comment.updated_at : undefined,
      body: comment.body?.trim() || undefined,
    })),
  });
};
