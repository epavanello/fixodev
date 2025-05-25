// We now use Octokit's webhook types for most things, but keep this type for backwards compatibility
export type GitHubEventType =
  | 'issues'
  | 'pull_request'
  | 'issue_comment'
  | 'pull_request_review'
  | 'pull_request_review_comment';
