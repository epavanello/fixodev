import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ManagedJob } from './job';
import { logger } from '../config/logger';

const DATA_DIR = join(process.cwd(), 'data');
const QUEUE_FILE = join(DATA_DIR, 'queue.json');

/**
 * Save queue to disk
 */
export const saveQueueToDisk = async (queue: ManagedJob[]): Promise<void> => {
  try {
    // Create data directory if it doesn't exist
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }

    // Filter only pending and processing jobs
    const activeJobs = queue.filter(job => job.status === 'pending' || job.status === 'processing');

    // Serialize queue and save to file
    const data = JSON.stringify(activeJobs, null, 2);
    await writeFile(QUEUE_FILE, data, 'utf8');

    logger.info(`Queue saved to disk (${activeJobs.length} active jobs)`);
  } catch (error) {
    logger.error(error, 'Failed to save queue to disk');
  }
};

/**
 * Load queue from disk
 */
export const loadQueueFromDisk = async (): Promise<ManagedJob[]> => {
  try {
    // Check if queue file exists
    if (!existsSync(QUEUE_FILE)) {
      logger.info('No queue file found, starting with empty queue');
      return [];
    }

    // Read file and parse JSON
    const data = await readFile(QUEUE_FILE, 'utf8');
    const loadedJobs = JSON.parse(data) as ManagedJob[];

    // Convert string dates back to Date objects
    loadedJobs.forEach(job => {
      job.createdAt = new Date(job.createdAt);
      job.updatedAt = new Date(job.updatedAt);
    });

    logger.info(`Loaded ${loadedJobs.length} jobs from disk`);

    return loadedJobs;
  } catch (error) {
    logger.error(error, 'Failed to load queue from disk, starting with empty queue.');
    return [];
  }
};
