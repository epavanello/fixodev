import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { GitHubEventType } from '@/types/github';

// Initialize webhooks instance
const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

interface WebhookPayload {
  action?: string;
  installation?: {
    id: number;
  };
  repository?: {
    full_name: string;
    clone_url: string;
  };
  issue?: {
    number: number;
  };
  pull_request?: {
    number: number;
  };
  comment?: {
    body: string;
  };
}

const router = new Hono();

router.post('/github', async c => {
  try {
    const signature = c.req.header('x-hub-signature-256');
    const event = c.req.header('x-github-event') as GitHubEventType;
    const deliveryId = c.req.header('x-github-delivery');

    if (!signature) {
      return c.json({ error: 'Missing webhook signature' }, 400);
    }

    const rawBody = await c.req.text();

    // Verify webhook signature
    const isValid = await webhooks.verify(rawBody, signature);

    if (!isValid) {
      return c.json({ error: 'Invalid webhook signature' }, 400);
    }

    const payload = JSON.parse(rawBody) as WebhookPayload;

    logger.info(
      {
        event,
        action: payload.action,
        repository: payload.repository?.full_name,
        deliveryId,
      },
      'Received GitHub webhook',
    );

    // Validate required payload fields
    if (!payload.installation?.id || !payload.repository?.clone_url || !event) {
      return c.json({ error: 'Missing required payload fields' }, 400);
    }

    // Create job for processing
    const job = jobQueue.addJob({
      repositoryUrl: payload.repository.clone_url,
      installationId: payload.installation.id,
      eventType: event,
      payload,
    });

    return c.json({ success: true, jobId: job.id });
  } catch (error) {
    logger.error({ error }, 'Error processing webhook');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export const webhookRouter = router;
