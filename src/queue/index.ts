import { QueuedJob } from '../types/jobs';
import { ManagedJob } from './job';
import { logger } from '../config/logger';
import { processJob } from './worker';
import { loadQueueFromDisk, saveQueueToDisk } from './persistence';

class JobQueue {
  private queue: ManagedJob[] = [];
  private isProcessing = false;
  private currentlyProcessingJobId: string | null = null;

  /**
   * Add a new job to the queue
   */
  public addJob(jobData: QueuedJob): ManagedJob {
    const now = new Date();
    const managedJob: ManagedJob = {
      ...jobData,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      logs: [],
    };

    this.queue.push(managedJob);
    logger.info({ jobId: managedJob.id, type: managedJob.type }, 'Job added to queue');

    if (!this.isProcessing) {
      this.processNextJob();
    }
    return managedJob;
  }

  /**
   * Get the next job from the queue that is not currently being processed.
   */
  private getNextJob(): ManagedJob | undefined {
    return this.queue.find(
      job => job.status === 'pending' && job.id !== this.currentlyProcessingJobId,
    );
  }

  /**
   * Process the next job in the queue
   */
  private async processNextJob() {
    if (this.isProcessing) {
      logger.debug('Already processing a job or processNextJob called concurrently');
      return;
    }

    const job = this.getNextJob();

    if (!job) {
      this.isProcessing = false;
      logger.debug('No pending jobs to process.');
      return;
    }

    this.isProcessing = true;
    this.currentlyProcessingJobId = job.id;

    try {
      job.status = 'processing';
      job.updatedAt = new Date();
      job.attempts += 1;

      logger.info({ jobId: job.id, type: job.type, attempt: job.attempts }, 'Processing job');

      await processJob(job);

      job.status = 'completed';
      job.logs.push(`Attempt ${job.attempts}: Job completed successfully`);
      logger.info({ jobId: job.id, type: job.type }, 'Job completed');
    } catch (error) {
      job.status = 'failed';
      const errorMessage = error instanceof Error ? error.message : String(error);
      job.logs.push(`Attempt ${job.attempts}: Job failed: ${errorMessage}`);
      logger.error(
        {
          jobId: job.id,
          type: job.type,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Job failed',
      );
    } finally {
      job.updatedAt = new Date();
      this.isProcessing = false;
      this.currentlyProcessingJobId = null;

      setTimeout(() => this.processNextJob(), 0);
    }
  }

  /**
   * Get all jobs in the queue
   */
  public getJobs(): ManagedJob[] {
    return [...this.queue];
  }

  /**
   * Get a job by ID
   */
  public getJob(id: string): ManagedJob | undefined {
    return this.queue.find(job => job.id === id);
  }

  public cleanupOldJobs() {
    this.queue = this.queue.filter(job => job.status === 'pending' || job.status === 'processing');
  }

  /**
   * Save queue state to disk - Placeholder if persistence.ts needs changes
   */
  public async saveState() {
    await saveQueueToDisk(this.queue);
    logger.info({ count: this.queue.length }, 'Queue state saved to disk.');
  }

  /**
   * Load queue state from disk
   */
  public async loadState() {
    try {
      const loadedJobs = await loadQueueFromDisk();
      this.queue = loadedJobs as ManagedJob[];
      logger.info({ count: this.queue.length }, 'Queue state loaded from disk.');
    } catch (error) {
      logger.error({ error }, 'Failed to load queue from disk. Starting with an empty queue.');
      this.queue = [];
    }
    if (!this.isProcessing) {
      this.processNextJob();
    }
  }
}

// Singleton instance
export const jobQueue = new JobQueue();
