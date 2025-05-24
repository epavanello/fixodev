import {
  Schema,
  IssuesEvent, // Represents various issue-related events
  PullRequestEvent, // Represents various PR-related events
  IssueCommentEvent, // Represents various issue comment events
  PullRequestReviewEvent, // Represents various PR review events
  PullRequestReviewCommentEvent, // Represents various PR review comment events
} from '@octokit/webhooks-types';

export const isIssueEvent = (event: Schema): event is IssuesEvent => {
  // Octokit's IssuesEvent typically has an 'issue' property and an 'action' property.
  // The absence of 'pull_request' helps distinguish from PR-related events.
  return 'issue' in event && !('pull_request' in event.issue) && 'action' in event;
};

export const isPullRequestEvent = (event: Schema): event is PullRequestEvent => {
  // Octokit's PullRequestEvent typically has a 'pull_request' property and an 'action' property.
  return 'pull_request' in event && 'action' in event;
};

export const isIssueCommentEvent = (event: Schema): event is IssueCommentEvent => {
  // Octokit's IssueCommentEvent typically has 'issue', 'comment', and 'action' properties.
  return 'issue' in event && 'comment' in event && 'action' in event;
};

export const isPullRequestCommentEvent = (event: Schema): event is IssueCommentEvent => {
  // A PR comment is an issue_comment event where the issue object also contains a pull_request object.
  return (
    isIssueCommentEvent(event) &&
    'pull_request' in event.issue &&
    event.issue.pull_request !== null
  );
};

export const isPullRequestReviewEvent = (event: Schema): event is PullRequestReviewEvent => {
  // Octokit's PullRequestReviewEvent typically has 'pull_request', 'review', and 'action' properties.
  return 'pull_request' in event && 'review' in event && 'action' in event;
};

export const isPullRequestReviewCommentEvent = (
  event: Schema,
): event is PullRequestReviewCommentEvent => {
  // Octokit's PullRequestReviewCommentEvent typically has 'pull_request', 'comment', and 'action' (on the comment object) properties.
  // It also has a 'review' object associated with the comment usually, or refers to a PR.
  // The check for 'review' might need refinement based on specific needs, here we assume its presence signifies this event type.
  return 'pull_request' in event && 'comment' in event && 'action' in event;
};
