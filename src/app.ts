import { Hono } from 'hono';
import { logger } from './config/logger';
import { appConfig } from './config/app';
import { jobQueue } from './queue';
import { webhookRouter } from './routes/webhook';
import { rootRouter } from './routes/root';
import { startNotificationPolling } from './polling/notificationPoller';
import { envConfig } from './config/env';

// Create Hono app
const app = new Hono();

// Register routes
app.route('/api/webhooks', webhookRouter);
app.route('/', rootRouter);

// Start the server
const start = async () => {
  try {
    // Load queue state from disk
    await jobQueue.loadState();

    // Start the notification poller if configured
    if (envConfig.BOT_USER_PAT && envConfig.BOT_NAME) {
      startNotificationPolling();
    } else {
      logger.warn('Notification poller not started: BOT_USER_PAT or BOT_NAME not configured.');
    }

    // Set up periodic queue persistence
    const SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    setInterval(() => {
      jobQueue.cleanupOldJobs();
      jobQueue.saveState();
    }, SAVE_INTERVAL);

    // Start the server using Hono's native server
    Bun.serve({
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
  await jobQueue.saveState();

  process.exit(0);
};

// Handle termination signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
