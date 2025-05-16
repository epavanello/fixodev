import { ManagedJob } from './job';
import { logger as rootLogger } from '../config/logger';
import { JobError } from '../utils/error';
import { isAppMentionJob, isUserMentionJob } from '../types/jobs';
import { handleMentionOnIssueJob } from '@/jobs/mentionHandler';

const logger = rootLogger.child({ context: 'JobWorker' });

/**
 * Process a job from the queue by dispatching it to the appropriate handler.
 */
export const processJob = async (job: ManagedJob): Promise<void> => {
  logger.info(
    {
      jobId: job.id,
      type: job.type,
      originalRepo: `${job.originalRepoOwner}/${job.originalRepoName}`,
    },
    'Worker received job for processing',
  );

  try {
    if (isAppMentionJob(job) || isUserMentionJob(job)) {
      await handleMentionOnIssueJob(job);
    } else {
      // This case should ideally not be reached if job types are well-defined and handled upstream.
      logger.error({ job }, 'Unknown job type received in worker');
      throw new JobError(`Unknown job: ${job}`);
    }
    logger.info({ jobId: job.id, type: job.type }, 'Job processing completed by handler');
  } catch (error) {
    logger.error({ jobId: job.id, type: job.type, error }, 'Job processing failed in worker');
    // The error should have been logged by the handler, but we re-throw to ensure queue marks it as failed.
    // JobQueue itself will catch this and update job status to 'failed'.
    if (error instanceof JobError) {
      throw error; // Re-throw JobErrors directly
    }
    throw new JobError(
      `Job ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
