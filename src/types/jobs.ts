interface BaseJob {
  id: string; // Unique job ID, typically from queue or delivery ID
  originalRepoOwner: string;
  originalRepoName: string;
  eventIssueNumber?: number;
  eventIssueTitle?: string;
  eventPullRequestNumber?: number;
  eventPullRequestTitle?: string;
}

/**
 * Common properties for all jobs processed by the worker.
 */
interface BaseMentionJob extends BaseJob {
  commandToProcess: string;
  triggeredBy: string;
}

/**
 * Job triggered by a GitHub App mention (issue or issue_comment).
 */
export interface AppMentionOnIssueJob extends BaseMentionJob {
  type: 'app_mention_issue';
  installationId: number;
  repositoryUrl: string;
  eventIssueNumber: number;
  eventIssueTitle: string;
}

/**
 * Job triggered by a mention of the dedicated GitHub User (@BOT_NAME).
 */
export interface UserMentionOnIssueJob extends BaseMentionJob {
  type: 'user_mention_issue';
  eventIssueNumber: number;
  eventIssueTitle: string;
}

/**
 * Job triggered by a GitHub App mention on a Pull Request comment.
 */
export interface AppMentionOnPullRequestJob extends BaseMentionJob {
  type: 'app_mention_pr';
  installationId: number;
  repositoryUrl: string;
  eventPullRequestNumber: number;
  eventPullRequestTitle: string;
  prHeadRef: string;
  prHeadSha: string;
}

/**
 * Union type for all possible jobs in the queue.
 */
export type QueuedJob = AppMentionOnIssueJob | UserMentionOnIssueJob | AppMentionOnPullRequestJob;

// Type Guards
export function isAppMentionOnIssueJob(job: QueuedJob): job is AppMentionOnIssueJob {
  return job.type === 'app_mention_issue';
}

export function isUserMentionOnIssueJob(job: QueuedJob): job is UserMentionOnIssueJob {
  return job.type === 'user_mention_issue';
}

export function isAppMentionOnPullRequestJob(job: QueuedJob): job is AppMentionOnPullRequestJob {
  return job.type === 'app_mention_pr';
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Represents the structure of a job as expected by the core job processing worker.
 * It includes all specific job fields at the top level, along with queue management state.
 * Timestamps are Date objects.
 */
export type WorkerJob = QueuedJob & {
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  logs: string[];
};
