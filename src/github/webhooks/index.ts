import { FastifyRequest, FastifyReply } from 'fastify';
import { envConfig } from '../../config/env';
import { logger } from '../../config/logger';
import { App } from '@/app';
import { Webhooks } from '@octokit/webhooks';
import { GitHubError } from '../../utils/error';
import { jobQueue } from '../../queue';

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

export const registerWebhookRoutes = (app: App) => {
  // GitHub webhook endpoint
  app.route({
    method: 'POST',
    url: '/api/webhooks/github',
    config: {
      rawBody: true,
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const signature = request.headers['x-hub-signature-256'] as string;
        const event = request.headers['x-github-event'] as string;
        const deliveryId = request.headers['x-github-delivery'] as string;

        // Verify webhook signature
        if (!signature) {
          throw new GitHubError('Missing webhook signature');
        }

        const isValid = await webhooks.verify(request.rawBody as string, signature);

        if (!isValid) {
          throw new GitHubError('Invalid webhook signature');
        }

        const payload = request.body as WebhookPayload;

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
        if (!payload.installation?.id || !payload.repository?.clone_url) {
          throw new GitHubError('Missing required payload fields');
        }

        // Create job for processing
        const job = jobQueue.addJob({
          repositoryUrl: payload.repository.clone_url,
          installationId: payload.installation.id,
          eventType: event,
          payload,
        });

        return { success: true, jobId: job.id };
      } catch (error) {
        logger.error({ error }, 'Error processing webhook');

        if (error instanceof GitHubError) {
          return reply.status(400).send({ error: error.message });
        }

        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  });
};
