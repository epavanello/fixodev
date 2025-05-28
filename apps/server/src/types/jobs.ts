import { Issue } from '@octokit/webhooks-types';

interface BaseJob {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  testJob?: boolean;
}

/**
 * Job triggered on a issue
 */
export interface IssueToPrJob extends BaseJob {
  issueNumber: number;
  triggeredBy: string;
  type: 'issue_to_pr';
  issue: Issue;
  installationId?: number;
}

/**
 * Union type for all possible jobs in the queue.
 */
export type QueuedJob = IssueToPrJob;

// Type Guards
export function isIssueToPrJob(job: QueuedJob): job is IssueToPrJob {
  return job.type === 'issue_to_pr';
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
