import { WorkerJob, isAppMentionJob, isUserMentionJob } from '../types/jobs';
import { logger as rootLogger } from '../config/logger';
import { JobError } from '../utils/error';
import { handleMentionOnIssueJob } from '@/jobs/mentionHandler';

const logger = rootLogger.child({ context: 'JobWorker' });

/**
 * Process a job from the queue by dispatching it to the appropriate handler.
 */
export const processJob = async (job: WorkerJob): Promise<void> => {
  const { id: jobId, type: jobType } = job;

  logger.info(
    {
      jobId,
      type: jobType,
      originalRepo: `${job.originalRepoOwner}/${job.originalRepoName}`,
    },
    'Worker received job for processing',
  );

  try {
    if (
      (jobType === 'app_mention' && isAppMentionJob(job)) ||
      (jobType === 'user_mention' && isUserMentionJob(job))
    ) {
      await handleMentionOnIssueJob(job);
    } else {
      logger.error({ jobId, type: jobType }, 'Unknown job type received in worker');
      throw new JobError(`Unknown job type: ${jobType} for job ID: ${jobId}`);
    }
    logger.info({ jobId, type: jobType }, 'Job processing completed by handler');
  } catch (error) {
    logger.error({ jobId, type: jobType, error }, 'Job processing failed in worker');
    if (error instanceof JobError) {
      throw error;
    }
    throw new JobError(
      `Job ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
