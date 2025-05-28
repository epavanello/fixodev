/**
 * Parse a GitHub issue URL to extract owner, repo, and issue number
 */
export function parseGitHubIssueUrl(issueUrl: string): {
  owner: string;
  repo: string;
  issueNumber: number;
} {
  // Support various GitHub issue URL formats:
  // https://github.com/owner/repo/issues/123
  // https://github.com/owner/repo/issues/123#issuecomment-456
  const urlPattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/;
  const match = issueUrl.match(urlPattern);

  if (!match) {
    throw new Error(
      `Invalid GitHub issue URL format: ${issueUrl}. Expected format: https://github.com/owner/repo/issues/123`,
    );
  }

  const [, owner, repo, issueNumberStr] = match;
  const issueNumber = parseInt(issueNumberStr, 10);

  if (isNaN(issueNumber)) {
    throw new Error(`Invalid issue number in URL: ${issueUrl}`);
  }

  return { owner, repo, issueNumber };
}
