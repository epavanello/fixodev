export interface GitHubUser {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  url: string;
  html_url: string;
}

export interface GitHubRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  owner: GitHubUser;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  default_branch: string;
}

export interface GitHubComment {
  id: number;
  node_id: string;
  url: string;
  html_url: string;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
}

export interface GitHubIssue {
  id: number;
  node_id: string;
  number: number;
  title: string;
  user: GitHubUser;
  state: 'open' | 'closed';
  locked: boolean;
  assignee: GitHubUser | null;
  assignees: GitHubUser[];
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  body: string | null;
}

export interface GitHubPullRequest extends GitHubIssue {
  html_url: string;
  diff_url: string;
  patch_url: string;
  issue_url: string;
  head: {
    label: string;
    ref: string;
    sha: string;
    user: GitHubUser;
    repo: GitHubRepository;
  };
  base: {
    label: string;
    ref: string;
    sha: string;
    user: GitHubUser;
    repo: GitHubRepository;
  };
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  merged_by: GitHubUser | null;
  comments: number;
  review_comments: number;
  maintainer_can_modify: boolean;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
}

export type GitHubEventType =
  | 'issues'
  | 'pull_request'
  | 'issue_comment'
  | 'pull_request_review'
  | 'pull_request_review_comment';

export interface GitHubEventPayload {
  action: string;
  repository: GitHubRepository;
  sender: GitHubUser;
  installation: {
    id: number;
    node_id: string;
  };
}

export interface IssueEventPayload extends GitHubEventPayload {
  issue: GitHubIssue;
}

export interface PullRequestEventPayload extends GitHubEventPayload {
  pull_request: GitHubPullRequest;
}

export interface IssueCommentEventPayload extends GitHubEventPayload {
  issue: GitHubIssue;
  comment: GitHubComment;
}

export interface PullRequestReviewEventPayload extends GitHubEventPayload {
  pull_request: GitHubPullRequest;
  review: {
    id: number;
    node_id: string;
    user: GitHubUser;
    body: string | null;
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
    html_url: string;
    pull_request_url: string;
    submitted_at: string;
  };
}

export interface PullRequestReviewCommentEventPayload extends GitHubEventPayload {
  pull_request: GitHubPullRequest;
  comment: GitHubComment;
  review: {
    id: number;
    node_id: string;
    user: GitHubUser;
    body: string | null;
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
    html_url: string;
    pull_request_url: string;
    submitted_at: string;
  };
}

export type GitHubEvent = {
  issues: IssueEventPayload;
  pull_request: PullRequestEventPayload;
  issue_comment: IssueCommentEventPayload;
  pull_request_review: PullRequestReviewEventPayload;
  pull_request_review_comment: PullRequestReviewCommentEventPayload;
}[GitHubEventType];
