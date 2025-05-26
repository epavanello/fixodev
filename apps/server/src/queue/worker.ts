import { WorkerJob, JobType, AppMentionOnIssueJob, AppMentionOnPullRequestJob } from "../types/jobs";
import { logger as rootLogger } from "../config/logger";
import { JobError } from "../utils/error";
import { handleMentionOnIssueJob, handleAppMentionOnPullRequestJob } from "@/jobs/mentionHandler";

const logger = rootLogger.child({ context: "JobWorker" });

/**
 * Type guard for AppMentionOnIssueJob
 */
export const isAppMentionJob = (job: WorkerJob): job is AppMentionOnIssueJob => {
  return job.type === JobType.AppMention;
};

/**
 * Type guard for AppMentionOnPullRequestJob
 */
export const isAppMentionOnPullRequestJob = (job: WorkerJob): job is AppMentionOnPullRequestJob => {
  return job.type === JobType.AppMentionOnPullRequest;
};

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
    "Worker received job for processing",
  );

  try {
    switch (jobType) {
      case JobType.AppMention:
        if (isAppMentionJob(job)) {
          await handleMentionOnIssueJob(job);
        } else {
          throw new JobError(`Invalid job payload for type ${jobType}`);
        }
        break;
      case JobType.AppMentionOnPullRequest:
        if (isAppMentionOnPullRequestJob(job)) {
          await handleAppMentionOnPullRequestJob(job);
        } else {
          throw new JobError(`Invalid job payload for type ${jobType}`);
        }
        break;
      default:
        logger.error({ jobId, type: jobType }, "Unknown job type received in worker");
        throw new JobError(`Unknown job type: ${jobType} for job ID: ${jobId}`);
    }
    logger.info({ jobId, type: jobType }, "Job processing completed by handler");
  } catch (error) {
    logger.error({ jobId, type: jobType, error }, "Job processing failed in worker");
    if (error instanceof JobError) {
      throw error;
    }
    throw new JobError(
      `Job ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
