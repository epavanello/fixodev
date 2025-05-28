import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { IssueToPrJob } from '../types/jobs';
import { WebhookEventName, WebhookEvent as OctokitWebhookEvent } from '@octokit/webhooks-types';
import { isIssueCommentEvent, isIssueEvent } from '@/types/guards';
import { isBotMentioned } from '@/utils/mention';

// Initialize webhooks instance
const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

const router = new Hono();

router.post('/github', async c => {
  try {
    const signature = c.req.header('x-hub-signature-256');
    const eventName = c.req.header('x-github-event') as WebhookEventName;
    const deliveryId = c.req.header('x-github-delivery');

    if (!signature) {
      return c.json({ error: 'Missing webhook signature' }, 400);
    }
    if (!eventName) {
      return c.json({ error: 'Missing X-GitHub-Event header' }, 400);
    }

    const rawBody = await c.req.text();
    const isValid = await webhooks.verify(rawBody, signature);

    if (!isValid) {
      return c.json({ error: 'Invalid webhook signature' }, 400);
    }

    const payload = JSON.parse(rawBody) as OctokitWebhookEvent;

    let eventAction: string | undefined;
    if ('action' in payload && payload.action) {
      eventAction = payload.action;
    }

    if (
      (eventName === 'issues' && isIssueEvent(payload) && payload.action === 'opened') ||
      (eventName === 'issue_comment' &&
        isIssueCommentEvent(payload) &&
        payload.action === 'created')
    ) {
      const issuePayload = payload;
      const shouldProcess = isBotMentioned(
        isIssueCommentEvent(payload) ? payload.comment.body : payload.issue.body,
        issuePayload.sender.login,
      );

      if (shouldProcess) {
        const jobToQueue: IssueToPrJob = {
          type: 'issue_to_pr',
          id: deliveryId || `app_mention_${Date.now()}`,
          issue: payload.issue,
          repoOwner: payload.repository.owner.login,
          repoName: payload.repository.name,
          issueNumber: payload.issue.number,
          triggeredBy: payload.sender.login,
          installationId: payload.installation?.id,
          repoUrl: payload.repository.clone_url,
        };

        const queuedJobEntry = await jobQueue.addJob(jobToQueue);

        logger.info(
          { jobId: queuedJobEntry.id, eventName, action: eventAction },
          'AppMentionJob event queued',
        );
        return c.json({ success: true, jobId: queuedJobEntry.id });
      }
    }

    logger.info(
      { deliveryId, eventName, action: eventAction },
      'Webhook event not suitable for AppMentionJob queueing (no mention, unsupported action, or missing data).',
    );
    return c.json({
      success: true,
      processed: false,
      message: 'Event not queued for AppMentionJob processing.',
    });
  } catch (error) {
    logger.error({ error: error }, 'Error processing webhook');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export const webhookRouter = router;
