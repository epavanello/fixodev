import fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config();

// Import configuration
import { appConfig } from './config/app';
import { logger } from './config/logger';

// Import webhooks
import { registerWebhookRoutes } from './github/webhooks';

// Import queue
import { jobQueue } from './queue';
import { loadQueueFromDisk, saveQueueToDisk } from './queue/persistence';

function createApp() {
  const app = fastify({
    logger,
  });

  // Register plugins
  app.register(cors, {
    origin: true, // Allow all origins in development
  });

  // Register routes
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

const app = createApp();

// Register webhook routes
registerWebhookRoutes(app);

// Start the server
const start = async () => {
  try {
    // Load queue state from disk
    const savedJobs = await loadQueueFromDisk();

    // TODO: Add logic to restore queue state

    // Set up periodic queue persistence
    const SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    setInterval(async () => {
      await saveQueueToDisk(jobQueue.getJobs());
    }, SAVE_INTERVAL);

    // Start server
    await app.listen({
      port: appConfig.port,
      host: appConfig.host,
    });

    app.log.info(`Server is running on ${appConfig.host}:${appConfig.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  app.log.info('Shutting down server...');

  // Save queue state before exiting
  await saveQueueToDisk(jobQueue.getJobs());

  await app.close();
  process.exit(0);
};

// Handle termination signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
