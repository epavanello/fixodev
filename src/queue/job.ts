import { QueuedJob } from '../types/jobs'; // Import the new centralized job type

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Represents a job as it is stored and managed by the JobQueue.
 * It combines a QueuedJob (AppMentionJob or UserMentionJob) with queue-specific metadata.
 */
export type ManagedJob = QueuedJob & {
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  logs: string[];
  // The 'id' from QueuedJob will be the primary identifier.
};

// The createJob function is removed as jobs are now constructed directly
// by webhook handlers or pollers as AppMentionJob or UserMentionJob.

// The old Job, WebhookEvent, and JobCreateParams interfaces are removed.
