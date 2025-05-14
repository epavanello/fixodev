import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { GitHubEventType } from '../types/github';
import { WebhookEvent } from '../queue/job';
import { IssueCommentCreatedEvent, IssuesOpenedEvent } from '@octokit/webhooks-types';
import { isIssueEvent, isIssueCommentEvent } from '../types/guards';

// Initialize webhooks instance
const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

const BOT_NAME = `@${envConfig.BOT_NAME}`;

// Type for our processed issue comment payloads, extending Octokit's type
interface ProcessedIssueCommentPayload extends IssueCommentCreatedEvent {
  command?: string;
}

// Define a similar type for issue events
interface ProcessedIssuePayload extends IssuesOpenedEvent {
  command?: string;
}

const router = new Hono();

// Check if the bot should respond to this comment
function shouldProcessComment(commentBody: string): { shouldProcess: boolean; command?: string } {
  // Check for @bot mention
  if (commentBody.includes(BOT_NAME)) {
    // Extract the command/request after the mention
    const mentionRegex = new RegExp(`${BOT_NAME}[ \t\r\n\f\v]+(.+)`, 'i');
    const match = commentBody.match(mentionRegex);
    if (match) {
      return { shouldProcess: true, command: match[1].trim() };
    }
    return { shouldProcess: true }; // Just mentioned without specific command
  }

  return { shouldProcess: false };
}

// Helper function to create WebhookEvent and add job to the queue
function createAndQueueJob<P extends ProcessedIssueCommentPayload | ProcessedIssuePayload>(params: {
  repositoryUrl: string;
  installationId: number;
  githubEventType: GitHubEventType; // From X-GitHub-Event header
  webhookEventNameForQueue: P extends ProcessedIssueCommentPayload ? 'issue_comment' : 'issues'; // For WebhookEvent.name
  enhancedPayload: P;
  deliveryId: string | undefined;
}): { id: string } {
  const {
    repositoryUrl,
    installationId,
    githubEventType,
    webhookEventNameForQueue,
    enhancedPayload,
    deliveryId,
  } = params;

  const webhookEvent: WebhookEvent<P> = {
    id: deliveryId || `event-${Date.now()}`,
    name: webhookEventNameForQueue,
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

    const rawBody = await c.req.text();

    // Verify webhook signature
    const isValid = await webhooks.verify(rawBody, signature);

    if (!isValid) {
      return c.json({ error: 'Invalid webhook signature' }, 400);
    }

    // Parse payload
    const payload = JSON.parse(rawBody) as IssueCommentCreatedEvent | IssuesOpenedEvent;

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
    if (event === 'issue_comment' && isIssueCommentEvent(payload) && payload.action === 'created') {
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
          `Processing ${BOT_NAME} command from comment`,
        );

        // Create enhanced payload with command
        const enhancedPayload: ProcessedIssueCommentPayload = {
          ...payload,
          command,
        };

        // Create job for processing with full context
        const job = createAndQueueJob({
          repositoryUrl: payload.repository.clone_url,
          installationId: payload.installation!.id,
          githubEventType: event,
          webhookEventNameForQueue: 'issue_comment',
          enhancedPayload,
          deliveryId,
        });

        return c.json({ success: true, jobId: job.id });
      } else {
        logger.debug(`Comment does not contain ${BOT_NAME} mention, ignoring`);
        return c.json({ success: true, processed: false });
      }
    }

    // Handle issue creation
    if (event === 'issues' && isIssueEvent(payload) && payload.action === 'opened') {
      const { shouldProcess, command } = shouldProcessComment(payload.issue.body!);

      if (shouldProcess) {
        logger.info(
          {
            command,
            issueNumber: payload.issue.number,
            issueTitle: payload.issue.title,
            repository: payload.repository.full_name,
            opener: payload.issue.user.login,
          },
          `Processing ${BOT_NAME} command from new issue body`,
        );

        // Create enhanced payload with command
        const enhancedPayload: ProcessedIssuePayload = {
          ...payload,
          command,
        };

        // Create job for processing with full context
        const job = createAndQueueJob({
          repositoryUrl: payload.repository.clone_url,
          installationId: payload.installation!.id,
          githubEventType: event,
          webhookEventNameForQueue: 'issues',
          enhancedPayload,
          deliveryId,
        });

        return c.json({ success: true, jobId: job.id });
      } else {
        logger.debug(`New issue does not contain ${BOT_NAME} mention, ignoring`);
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
