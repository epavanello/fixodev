import { WorkerJob, isIssueToPrJob } from '../types/jobs';
import { defaultLogger } from '../utils/logger';
import { handleIssueToPrJob } from '@/jobs/issueToPrHandler';

/**
 * Process a job from the queue by dispatching it to the appropriate handler.
 */
export const processJob = async (job: WorkerJob): Promise<void> => {
  const { id: jobId, type: jobType } = job;

  if (jobType === 'issue_to_pr' && isIssueToPrJob(job)) {
    await defaultLogger.execute(() => handleIssueToPrJob(job), 'handle issue to pr job', {
      jobId,
      jobType,
    });
  } else {
    throw new Error(`Unknown job type: ${jobType}`);
  }
};
