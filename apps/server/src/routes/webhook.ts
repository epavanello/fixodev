import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { AppMentionOnIssueJob } from '../types/jobs';
import { WebhookEventName, WebhookEvent as OctokitWebhookEvent } from '@octokit/webhooks-types';
import { isIssueCommentEvent, isIssueEvent } from '@/types/guards';
import { getBotCommandFromPayload } from '@/utils/mention';

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

    let commandToProcess: string | undefined;
    let issueNumber: number | undefined;
    let issueTitle: string | undefined;
    let repoOwner: string | undefined;
    let repoName: string | undefined;
    let repositoryUrl: string | undefined;
    let installationId: number | undefined;
    let senderLogin: string | undefined;
    let shouldProcessEvent = false;

    if (eventName === 'issues' && isIssueEvent(payload) && payload.action === 'opened') {
      const issuePayload = payload;
      const { shouldProcess, command } = getBotCommandFromPayload(
        issuePayload.issue.body,
        issuePayload.sender.login,
      );
      if (shouldProcess) {
        commandToProcess = command;
        issueNumber = issuePayload.issue.number;
        issueTitle = issuePayload.issue.title;
        repoOwner = issuePayload.repository.owner.login;
        repoName = issuePayload.repository.name;
        repositoryUrl = issuePayload.repository.clone_url;
        installationId = issuePayload.installation?.id;
        senderLogin = issuePayload.sender.login;
        shouldProcessEvent = true;
        logger.info(
          { deliveryId, eventName, repo: `${repoOwner}/${repoName}`, issue: issueNumber },
          'Processing mention from new issue',
        );
      }
    } else if (
      eventName === 'issue_comment' &&
      isIssueCommentEvent(payload) &&
      payload.action === 'created'
    ) {
      const commentPayload = payload;

      const { shouldProcess, command } = getBotCommandFromPayload(
        commentPayload.comment.body,
        commentPayload.sender.login,
      );
      if (shouldProcess) {
        commandToProcess = command;
        issueNumber = commentPayload.issue.number;
        issueTitle = commentPayload.issue.title;
        repoOwner = commentPayload.repository.owner.login;
        repoName = commentPayload.repository.name;
        repositoryUrl = commentPayload.repository.clone_url;
        installationId = commentPayload.installation?.id;
        senderLogin = commentPayload.sender.login;
        shouldProcessEvent = true;
        logger.info(
          { deliveryId, eventName, repo: `${repoOwner}/${repoName}`, issue: issueNumber },
          'Processing mention from issue comment',
        );
      }
    }

    if (
      shouldProcessEvent &&
      commandToProcess &&
      issueNumber &&
      issueTitle &&
      repoOwner &&
      repoName &&
      repositoryUrl &&
      installationId &&
      senderLogin
    ) {
      const jobToQueue: AppMentionOnIssueJob = {
        id: deliveryId || `app_mention_${Date.now()}`,
        type: 'app_mention',
        originalRepoOwner: repoOwner,
        originalRepoName: repoName,
        eventIssueNumber: issueNumber,
        eventIssueTitle: issueTitle,
        commandToProcess: commandToProcess,
        triggeredBy: senderLogin,
        installationId: installationId,
        repositoryUrl: repositoryUrl,
      };

      const queuedJobEntry = await jobQueue.addJob(jobToQueue);

      logger.info(
        { jobId: queuedJobEntry.id, eventName, action: eventAction },
        'AppMentionJob event queued',
      );
      return c.json({ success: true, jobId: queuedJobEntry.id });
    } else {
      logger.info(
        { deliveryId, eventName, action: eventAction },
        'Webhook event not suitable for AppMentionJob queueing (no mention, unsupported action, or missing data).',
      );
      return c.json({
        success: true,
        processed: false,
        message: 'Event not queued for AppMentionJob processing.',
      });
    }
  } catch (error) {
    logger.error({ error: error }, 'Error processing webhook');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export const webhookRouter = router;
