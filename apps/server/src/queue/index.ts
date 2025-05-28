import { IssueToPrJob, QueuedJob, WorkerJob, JobStatus } from '../types/jobs';
import { processJob } from './worker';
import { db } from '../db';
import { jobsTable, JobInsert, JobSelect } from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { OperationLogger } from '@/utils/logger';

class JobQueue {
  private isProcessing = false;
  private maxRetries = 3;
  private jobTimeoutMs = 10 * 60 * 3_000;
  private logger = new OperationLogger({ context: 'JobQueue' });

  constructor() {
    this.logger.safe(
      () =>
        db.update(jobsTable).set({ status: 'pending' }).where(eq(jobsTable.status, 'processing')),
      'reset pending jobs on startup',
    );
  }

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

    const result = await this.logger.execute(
      () => db.insert(jobsTable).values(newJob).returning(),
      'add job to queue',
      { jobId, jobType: type },
    );

    if (!this.isProcessing) {
      // Process jobs asynchronously without blocking the response
      setImmediate(() => {
        this.logger.safe(() => this.processNextJob(), 'process next job');
      });
    }

    return result[0];
  }

  /**
   * Get the next job from the database that is pending and not currently being processed.
   * Prioritizes older jobs.
   */
  private async getNextJob(): Promise<JobSelect | undefined> {
    const conditions = [eq(jobsTable.status, 'pending')];

    const result = await this.logger.safe(
      () =>
        db
          .select()
          .from(jobsTable)
          .where(and(...conditions))
          .orderBy(asc(jobsTable.createdAt))
          .limit(1),
      'get next job from queue',
    );

    return result.ok ? result.data[0] : undefined;
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

    const jobLogger = this.logger.child({
      jobId: jobFromDb.id,
      jobType: jobFromDb.type,
      attempt: currentAttempt,
    });

    // Update job status to 'processing' in DB
    const updateResult = await jobLogger.safe(
      () =>
        db
          .update(jobsTable)
          .set({
            status: 'processing',
            updatedAt: jobProcessingStartTime,
            attempts: currentAttempt,
          })
          .where(eq(jobsTable.id, jobFromDb.id)),
      'update job to processing',
    );

    if (!updateResult.ok) {
      await jobLogger.safe(
        () =>
          db
            .update(jobsTable)
            .set({
              status: 'failed',
              updatedAt: new Date(),
              attempts: currentAttempt,
              logs: [...jobFromDb.logs, 'Internal Error: Failed to update job to processing in DB'],
            })
            .where(eq(jobsTable.id, jobFromDb.id)),
        'update job to failed after processing error',
      );

      this.isProcessing = false;
      setTimeout(() => {
        this.logger.safe(() => this.processNextJob(), 'process next job after error');
      }, 1_000);
      return;
    }

    let specificQueuedJobPart: QueuedJob;
    if (jobFromDb.type === 'issue_to_pr') {
      specificQueuedJobPart = {
        ...(jobFromDb.payload as Omit<IssueToPrJob, 'id' | 'type'>),
        id: jobFromDb.id,
        type: 'issue_to_pr',
      } as IssueToPrJob;
    } else {
      this.isProcessing = false;
      await jobLogger.safe(
        () =>
          db
            .update(jobsTable)
            .set({
              status: 'failed',
              logs: [...jobFromDb.logs, 'Internal Error: Unknown job type from DB'],
              updatedAt: new Date(),
            })
            .where(eq(jobsTable.id, jobFromDb.id)),
        'update job to failed due to unknown type',
      );

      setImmediate(() => {
        this.logger.safe(() => this.processNextJob(), 'process next job after unknown type');
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

    const jobTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Job processing timeout')), this.jobTimeoutMs);
    });

    const jobResult = await jobLogger.safe(
      () => Promise.race([processJob(jobForWorker), jobTimeoutPromise]),
      'process job with timeout',
      { timeoutMs: this.jobTimeoutMs },
    );

    if (jobResult.ok) {
      // Job completed successfully
      await jobLogger.safe(
        () =>
          db
            .update(jobsTable)
            .set({
              status: 'completed',
              logs: jobForWorker.logs,
              updatedAt: new Date(),
            })
            .where(eq(jobsTable.id, jobForWorker.id)),
        'update job to completed',
      );
    } else {
      const errorMessage = jobResult.error.message;
      jobForWorker.logs.push(`Attempt ${jobForWorker.attempts}: Job failed: ${errorMessage}`);

      const newStatus: JobStatus = jobForWorker.attempts >= this.maxRetries ? 'failed' : 'pending';

      await jobLogger.safe(
        () =>
          db
            .update(jobsTable)
            .set({
              status: newStatus,
              logs: jobForWorker.logs,
              updatedAt: new Date(),
            })
            .where(eq(jobsTable.id, jobForWorker.id)),
        'update job status after failure',
        { newStatus, maxRetries: this.maxRetries },
      );
    }

    this.isProcessing = false;
    // Immediately try to process the next job asynchronously
    setImmediate(() => {
      this.logger.safe(() => this.processNextJob(), 'process next job in cycle');
    });
  }
}

// Singleton instance
export const jobQueue = new JobQueue();
