interface BaseJob {
  id: string; // Unique job ID, typically from queue or delivery ID
  originalRepoOwner: string;
  originalRepoName: string;
  eventIssueNumber: number;
  eventIssueTitle: string;
}

/**
 * Common properties for all jobs processed by the worker.
 */
interface BaseMentionOnIssueJob extends BaseJob {
  commandToProcess: string; // The full command string from the issue/comment body
  triggeredBy: string; // Username or App name that triggered the event
}

/**
 * Job triggered by a GitHub App mention (issue or issue_comment).
 */
export interface AppMentionOnIssueJob extends BaseMentionOnIssueJob {
  type: 'app_mention';
  installationId: number;
  repositoryUrl: string; // Clone URL for the original repository
  // Specific event payload for App mentions, if needed for detailed context later
  // For now, common fields are in BaseJob. Can add specific event types if handlers need them.
  // eventPayload: IssuesOpenedEvent | IssueCommentCreatedEvent;
}

/**
 * Job triggered by a mention of the dedicated GitHub User (@BOT_NAME).
 */
export interface UserMentionOnIssueJob extends BaseMentionOnIssueJob {
  type: 'user_mention';
}

/**
 * Union type for all possible jobs in the queue.
 */
export type QueuedJob = AppMentionOnIssueJob | UserMentionOnIssueJob;

// Type Guards
export function isAppMentionJob(job: QueuedJob): job is AppMentionOnIssueJob {
  return job.type === 'app_mention';
}

export function isUserMentionJob(job: QueuedJob): job is UserMentionOnIssueJob {
  return job.type === 'user_mention';
}
