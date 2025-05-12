import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Job } from './job';
import { logger } from '../config/logger';

const DATA_DIR = join(process.cwd(), 'data');
const QUEUE_FILE = join(DATA_DIR, 'queue.json');

/**
 * Save queue to disk
 */
export const saveQueueToDisk = async (queue: Job[]): Promise<void> => {
  try {
    // Create data directory if it doesn't exist
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }

    // Serialize queue and save to file
    const data = JSON.stringify(queue, null, 2);
    await writeFile(QUEUE_FILE, data, 'utf8');

    logger.info('Queue saved to disk');
  } catch (error) {
    logger.error(error, 'Failed to save queue to disk');
  }
};

/**
 * Load queue from disk
 */
export const loadQueueFromDisk = async (): Promise<Job[]> => {
  try {
    // Check if queue file exists
    if (!existsSync(QUEUE_FILE)) {
      logger.info('No queue file found, starting with empty queue');
      return [];
    }

    // Read file and parse JSON
    const data = await readFile(QUEUE_FILE, 'utf8');
    const queue = JSON.parse(data) as Job[];

    // Convert string dates back to Date objects
    queue.forEach(job => {
      job.createdAt = new Date(job.createdAt);
      job.updatedAt = new Date(job.updatedAt);
    });

    logger.info(`Loaded ${queue.length} jobs from disk`);

    return queue;
  } catch (error) {
    logger.error(error, 'Failed to load queue from disk');
    return [];
  }
};
