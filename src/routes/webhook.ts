import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { GitHubEventType } from '../types/github';
import { WebhookEvent } from '../queue/job';
import { Schema, WebhookEvent as OctokitWebhookEvent } from '@octokit/webhooks-types';

// Initialize webhooks instance
const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

const router = new Hono();

// Helper function to create WebhookEvent and add job to the queue
function createAndQueueJob<T extends Schema>(params: {
  repositoryUrl: string;
  installationId: number;
  githubEventType: GitHubEventType;
  enhancedPayload: T;
  deliveryId: string | undefined;
}): { id: string } {
  const { repositoryUrl, installationId, githubEventType, enhancedPayload, deliveryId } = params;

  const webhookEvent: WebhookEvent<T> = {
    id: deliveryId || `event-${Date.now()}`,
    name: githubEventType,
    payload: enhancedPayload,
  };

  const job = jobQueue.addJob({
    repositoryUrl,
    installationId,
    eventType: githubEventType,
    event: webhookEvent,
  });

  return job;
}

router.post('/github', async c => {
  try {
    const signature = c.req.header('x-hub-signature-256');
    const event = c.req.header('x-github-event') as GitHubEventType;
    const deliveryId = c.req.header('x-github-delivery');

    if (!signature) {
      return c.json({ error: 'Missing webhook signature' }, 400);
    }
    if (!event) {
      return c.json({ error: 'Missing X-GitHub-Event header' }, 400);
    }

    const rawBody = await c.req.text();

    const isValid = await webhooks.verify(rawBody, signature);

    if (!isValid) {
      return c.json({ error: 'Invalid webhook signature' }, 400);
    }

    const payload = JSON.parse(rawBody) as OctokitWebhookEvent;

    if (
      payload &&
      typeof payload === 'object' &&
      'action' in payload &&
      payload.action &&
      'repository' in payload &&
      payload.repository &&
      typeof payload.repository.clone_url === 'string' &&
      'installation' in payload &&
      payload.installation &&
      typeof payload.installation.id === 'number'
    ) {
      logger.info(
        {
          event,
          action: payload.action,
          repository: payload.repository.full_name,
        },
        `Webhook event suitable for queueing.`,
      );

      const job = createAndQueueJob({
        repositoryUrl: payload.repository.clone_url,
        installationId: payload.installation.id,
        githubEventType: event,
        enhancedPayload: payload,
        deliveryId,
      });

      logger.info({ jobId: job.id, event, action: payload.action }, 'Webhook event queued');
      return c.json({ success: true, jobId: job.id });
    } else {
      logger.info(
        { event },
        'Received GitHub webhook not suitable for queueing (missing repository, installation, or required fields).',
      );
      return c.json({
        success: true,
        processed: false,
        message: 'Event not queued, missing essential information for processing.',
      });
    }
  } catch (error) {
    logger.error({ error }, 'Error processing webhook');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export const webhookRouter = router;
