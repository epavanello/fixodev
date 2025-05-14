import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from './config/logger';
import { appConfig } from './config/app';
import { jobQueue } from './queue';
import { saveQueueToDisk } from './queue/persistence';
import { webhookRouter } from './routes/webhook';
import { rootRouter } from './routes/root';

// Load environment variables
import { config } from 'dotenv';
config();

// Create Hono app
const app = new Hono();

// Register routes
app.route('/api/webhooks', webhookRouter);
app.route('/', rootRouter);

// Start the server
const start = async () => {
  try {
    // Load queue state from disk
    jobQueue.loadState();

    // Set up periodic queue persistence
    const SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    setInterval(() => {
      saveQueueToDisk(jobQueue.getJobs());
    }, SAVE_INTERVAL);

    // Start the server
    serve({
      fetch: app.fetch,
      port: appConfig.port,
      hostname: appConfig.host,
    });

    logger.info(`Server is running on ${appConfig.host}:${appConfig.port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');

  // Save queue state before exiting
  await saveQueueToDisk(jobQueue.getJobs());

  process.exit(0);
};

// Handle termination signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
