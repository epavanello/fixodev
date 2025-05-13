import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { GitHubEventType } from '../types/github';
import { WebhookEvent } from '../queue/job';
import { IssueCommentCreatedEvent } from '@octokit/webhooks-types';

// Initialize webhooks instance
const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

const BOT_NAME = envConfig.BOT_NAME;

// Type for our processed issue comment payloads, extending Octokit's type
interface ProcessedIssueCommentPayload extends IssueCommentCreatedEvent {
  command?: string;
}

const router = new Hono();

// Check if the bot should respond to this comment
function shouldProcessComment(commentBody: string): { shouldProcess: boolean; command?: string } {
  // Check for @reposister mention
  if (commentBody.includes(`@${BOT_NAME}`)) {
    // Extract the command/request after the mention
    const mentionRegex = new RegExp(`@${BOT_NAME}\\s+(.+)`, 'i');
    const match = commentBody.match(mentionRegex);
    if (match) {
      return { shouldProcess: true, command: match[1].trim() };
    }
    return { shouldProcess: true }; // Just mentioned without specific command
  }

  return { shouldProcess: false };
}

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

    // Parse payload
    const payload = JSON.parse(rawBody) as IssueCommentCreatedEvent;

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
    if (!payload.installation?.id || !payload.repository?.url || !event) {
      return c.json({ error: 'Missing required payload fields' }, 400);
    }

    // Handle issue comments specifically
    if (
      event === 'issue_comment' &&
      payload.action === 'created' &&
      'comment' in payload &&
      'issue' in payload
    ) {
      const { shouldProcess, command } = shouldProcessComment(payload.comment.body);

      if (shouldProcess) {
        logger.info(
          {
            command,
            issueNumber: payload.issue.number,
            issueTitle: payload.issue.title,
            repository: payload.repository.full_name,
            commenter: payload.comment.user.login,
          },
          'Processing @reposister command from comment',
        );

        // Create enhanced payload with command
        const enhancedPayload: ProcessedIssueCommentPayload = {
          ...payload,
          command,
        };

        // Create webhook event object with ID and enhanced payload
        const webhookEvent: WebhookEvent<ProcessedIssueCommentPayload> = {
          id: deliveryId || `event-${Date.now()}`,
          name: 'issue_comment',
          payload: enhancedPayload,
        };

        // Create job for processing with full context
        const job = jobQueue.addJob({
          repositoryUrl: payload.repository.clone_url,
          installationId: payload.installation.id,
          eventType: event,
          payload: webhookEvent,
        });

        return c.json({ success: true, jobId: job.id });
      } else {
        logger.debug('Comment does not contain @reposister mention, ignoring');
        return c.json({ success: true, processed: false });
      }
    }

    // For other events, just acknowledge receipt
    return c.json({ success: true, processed: false });
  } catch (error) {
    logger.error({ error }, 'Error processing webhook');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export const webhookRouter = router;
