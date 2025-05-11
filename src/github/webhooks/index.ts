import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { envConfig } from '../../config/env';
import { logger } from '../../config/logger';

interface WebhookPayload {
  action?: string;
  installation?: {
    id: number;
  };
  repository?: {
    full_name: string;
    clone_url: string;
  };
}

export const registerWebhookRoutes = (app: FastifyInstance) => {
  // GitHub webhook endpoint
  app.post('/api/webhooks/github', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const signature = request.headers['x-hub-signature-256'] as string;
      const event = request.headers['x-github-event'] as string;

      // TODO: Implement webhook signature verification
      // TODO: Implement webhook payload parsing

      const payload = request.body as WebhookPayload;

      logger.info(
        {
          event,
          action: payload.action,
          repository: payload.repository?.full_name,
        },
        'Received GitHub webhook',
      );

      // TODO: Route to appropriate handler
      // TODO: Queue job for processing

      return { success: true };
    } catch (error) {
      logger.error(error, 'Error processing webhook');
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
};
