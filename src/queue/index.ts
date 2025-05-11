import { Job, JobCreateParams, createJob } from './job';
import { logger } from '../config/logger';

class JobQueue {
  private queue: Job[] = [];
  private isProcessing = false;

  /**
   * Add a new job to the queue
   */
  public addJob(params: JobCreateParams): Job {
    const job = createJob(params);
    this.queue.push(job);

    logger.info({ jobId: job.id, repositoryUrl: job.repositoryUrl }, 'Job added to queue');

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processNextJob();
    }

    return job;
  }

  /**
   * Get the next job from the queue
   */
  private getNextJob(): Job | undefined {
    return this.queue.find(job => job.status === 'pending');
  }

  /**
   * Process the next job in the queue
   */
  private async processNextJob() {
    if (this.isProcessing) {
      return;
    }

    const job = this.getNextJob();

    if (!job) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    try {
      // Update job status
      job.status = 'processing';
      job.updatedAt = new Date();
      job.attempts += 1;

      logger.info({ jobId: job.id }, 'Processing job');

      // TODO: Implement actual job processing
      // For now, just simulate processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mark job as completed
      job.status = 'completed';
      job.updatedAt = new Date();
      job.logs.push('Job completed successfully');

      logger.info({ jobId: job.id }, 'Job completed');
    } catch (error) {
      // Mark job as failed
      job.status = 'failed';
      job.updatedAt = new Date();
      job.logs.push(`Job failed: ${error instanceof Error ? error.message : String(error)}`);

      logger.error({ jobId: job.id, error }, 'Job failed');
    } finally {
      this.isProcessing = false;

      // Continue processing queue
      if (this.getNextJob()) {
        this.processNextJob();
      }
    }
  }

  /**
   * Get all jobs in the queue
   */
  public getJobs(): Job[] {
    return [...this.queue];
  }

  /**
   * Get a job by ID
   */
  public getJob(id: string): Job | undefined {
    return this.queue.find(job => job.id === id);
  }

  /**
   * Save queue state to disk
   * TODO: Implement actual persistence
   */
  public saveState(): void {
    logger.info('Queue state saved');
  }

  /**
   * Load queue state from disk
   * TODO: Implement actual persistence
   */
  public loadState(): void {
    logger.info('Queue state loaded');
  }
}

// Singleton instance
export const jobQueue = new JobQueue();
