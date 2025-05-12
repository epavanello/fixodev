import {
  GitHubEvent,
  IssueEventPayload,
  PullRequestEventPayload,
  IssueCommentEventPayload,
  PullRequestReviewEventPayload,
  PullRequestReviewCommentEventPayload,
} from './github';

export const isIssueEvent = (event: GitHubEvent): event is IssueEventPayload => {
  return 'issue' in event && !('pull_request' in event);
};

export const isPullRequestEvent = (event: GitHubEvent): event is PullRequestEventPayload => {
  return 'pull_request' in event;
};

export const isIssueCommentEvent = (event: GitHubEvent): event is IssueCommentEventPayload => {
  return 'issue' in event && 'comment' in event;
};

export const isPullRequestReviewEvent = (
  event: GitHubEvent,
): event is PullRequestReviewEventPayload => {
  return 'pull_request' in event && 'review' in event;
};

export const isPullRequestReviewCommentEvent = (
  event: GitHubEvent,
): event is PullRequestReviewCommentEventPayload => {
  return 'pull_request' in event && 'comment' in event && 'review' in event;
};
