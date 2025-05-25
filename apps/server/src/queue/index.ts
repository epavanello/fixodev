import {
  AppMentionOnIssueJob,
  QueuedJob,
  UserMentionOnIssueJob,
  WorkerJob,
  JobStatus,
} from '../types/jobs';
import { logger } from '../config/logger';
import { processJob } from './worker';
import { db } from '../db';
import { jobsTable, JobInsert, JobSelect } from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

class JobQueue {
  private isProcessing = false;
  private maxRetries = 3;
  private jobTimeoutMs = 10 * 60 * 3_000;

  /**
   * Add a new job to the queue.
   * The payload will contain all properties of QueuedJob except 'id' and 'type'.
   */
  public async addJob(jobData: QueuedJob): Promise<JobSelect> {
    const { id, type, ...payloadData } = jobData;
    const jobId = id || uuidv4();
    const now = new Date();

    const newJob: JobInsert = {
      id: jobId,
      type: type,
      payload: payloadData,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      logs: [],
    };

    const result = (await db.insert(jobsTable).values(newJob).returning())[0];

    if (!this.isProcessing) {
      // Process jobs asynchronously without blocking the response
      setImmediate(() => {
        this.processNextJob().catch(error => {
          logger.error({ error }, 'Unhandled error in async job processing');
        });
      });
    }

    return result;
  }

  /**
   * Get the next job from the database that is pending and not currently being processed.
   * Prioritizes older jobs.
   */
  private async getNextJob(): Promise<JobSelect | undefined> {
    try {
      const conditions = [eq(jobsTable.status, 'pending')];

      const result = await db
        .select()
        .from(jobsTable)
        .where(and(...conditions))
        .orderBy(asc(jobsTable.createdAt))
        .limit(1);

      return result[0];
    } catch (error) {
      logger.error({ error }, 'Failed to get next job from database');
      return undefined;
    }
  }

  /**
   * Process the next job in the queue
   */
  async processNextJob(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    const jobFromDb = await this.getNextJob();

    if (!jobFromDb) {
      return;
    }

    this.isProcessing = true;
    const currentAttempt = jobFromDb.attempts + 1;
    const jobProcessingStartTime = new Date();

    // Update job status to 'processing' in DB
    try {
      await db
        .update(jobsTable)
        .set({
          status: 'processing',
          updatedAt: jobProcessingStartTime,
          attempts: currentAttempt,
        })
        .where(eq(jobsTable.id, jobFromDb.id));
    } catch (dbError) {
      logger.error(
        { jobId: jobFromDb.id, error: dbError },
        'Failed to update job to processing in DB',
      );
      this.isProcessing = false;
      setTimeout(() => {
        this.processNextJob().catch(error => {
          logger.error({ error }, 'Error in delayed job processing retry');
        });
      }, 1000);
      return;
    }

    // Construct WorkerJob from JobSelect (jobFromDb)
    let specificQueuedJobPart: QueuedJob;
    if (jobFromDb.type === 'app_mention') {
      specificQueuedJobPart = {
        ...(jobFromDb.payload as Omit<AppMentionOnIssueJob, 'id' | 'type'>),
        id: jobFromDb.id,
        type: 'app_mention',
      } as AppMentionOnIssueJob;
    } else if (jobFromDb.type === 'user_mention') {
      specificQueuedJobPart = {
        ...(jobFromDb.payload as Omit<UserMentionOnIssueJob, 'id' | 'type'>),
        id: jobFromDb.id,
        type: 'user_mention',
      } as UserMentionOnIssueJob;
    } else {
      // Should not happen if DB types are constrained
      logger.error(
        { jobId: jobFromDb.id, type: jobFromDb.type },
        'Unknown job type from DB during WorkerJob construction',
      );
      // Handle error appropriately, maybe mark job as failed and return
      this.isProcessing = false;
      // Mark as failed to prevent reprocessing loop for unknown type
      await db
        .update(jobsTable)
        .set({
          status: 'failed',
          logs: [...jobFromDb.logs, 'Internal Error: Unknown job type from DB'],
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, jobFromDb.id));
      setImmediate(() => {
        this.processNextJob().catch(error => {
          logger.error({ error }, 'Error in job processing after unknown type failure');
        });
      });
      return;
    }

    const jobForWorker: WorkerJob = {
      ...specificQueuedJobPart,
      status: 'processing',
      createdAt: new Date(jobFromDb.createdAt),
      updatedAt: jobProcessingStartTime,
      attempts: currentAttempt,
      logs: [...jobFromDb.logs],
    };

    logger.info(
      { jobId: jobForWorker.id, type: jobForWorker.type, attempt: jobForWorker.attempts },
      'Processing job',
    );

    try {
      // Add timeout to job processing
      const jobTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job processing timeout')), this.jobTimeoutMs);
      });

      await Promise.race([processJob(jobForWorker), jobTimeoutPromise]);

      // Job completed successfully
      logger.info({ jobId: jobForWorker.id, type: jobForWorker.type }, 'Job completed by worker');
      await db
        .update(jobsTable)
        .set({
          status: 'completed',
          logs: jobForWorker.logs,
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, jobForWorker.id));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      jobForWorker.logs.push(`Attempt ${jobForWorker.attempts}: Job failed: ${errorMessage}`);
      logger.error(
        {
          jobId: jobForWorker.id,
          type: jobForWorker.type,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Job processing failed',
      );

      const newStatus: JobStatus = jobForWorker.attempts >= this.maxRetries ? 'failed' : 'pending';

      await db
        .update(jobsTable)
        .set({
          status: newStatus,
          logs: jobForWorker.logs,
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, jobForWorker.id));

      if (newStatus === 'pending') {
        logger.info({ jobId: jobForWorker.id }, 'Job re-queued after failure');
      } else {
        logger.warn({ jobId: jobForWorker.id }, 'Job failed after max retries');
      }
    } finally {
      this.isProcessing = false;
      // Immediately try to process the next job asynchronously
      setImmediate(() => {
        this.processNextJob().catch(error => {
          logger.error({ error }, 'Error in next job processing cycle');
        });
      });
    }
  }
}

// Singleton instance
export const jobQueue = new JobQueue();
