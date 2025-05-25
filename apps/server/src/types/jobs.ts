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
  commandToProcess: string;
  triggeredBy: string;
}

/**
 * Job triggered by a GitHub App mention (issue or issue_comment).
 */
export interface AppMentionOnIssueJob extends BaseMentionOnIssueJob {
  type: 'app_mention';
  installationId: number;
  repositoryUrl: string;
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
