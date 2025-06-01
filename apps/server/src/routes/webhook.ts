import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { IssueToPrJob, PrUpdateJob } from '../types/jobs';
import { WebhookEventName, WebhookEvent as OctokitWebhookEvent } from '@octokit/webhooks-types';
import { isIssueCommentEvent, isIssueEvent, isPullRequestComment } from '@/types/guards';
import { isBotMentioned } from '@/utils/mention';
import { getPullRequest } from '@/github/pr';
import { GitHubApp } from '@/github/app';

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

    const gitHubApp = new GitHubApp();

    let eventAction: string | undefined;
    if ('action' in payload && payload.action) {
      eventAction = payload.action;
    }

    logger.info({ eventName, eventAction, deliveryId }, 'Webhook event');

    if (
      ((eventName === 'issues' && isIssueEvent(payload) && payload.action === 'opened') ||
        (eventName === 'issue_comment' &&
          isIssueCommentEvent(payload) &&
          payload.action === 'created')) &&
      payload.installation?.id
    ) {
      const octokit = await gitHubApp.getAuthenticatedClient(payload.installation.id);

      const instructions = isIssueCommentEvent(payload) ? payload.comment.body : payload.issue.body;

      const shouldProcess = isBotMentioned(instructions, payload.sender.login);

      if (shouldProcess) {
        // Check if this is a comment on a PR (GitHub treats PR comments as issue comments)
        if (isIssueCommentEvent(payload) && isPullRequestComment(payload)) {
          const pr = await getPullRequest(
            octokit,
            payload.repository.owner.login,
            payload.repository.name,
            payload.issue.number,
          );

          // This is a comment on a PR - create PrUpdateJob
          const prUpdateJob: PrUpdateJob = {
            type: 'pr_update',
            id: deliveryId || `pr_update_${Date.now()}`,
            pullRequest: pr,
            repoOwner: payload.repository.owner.login,
            repoName: payload.repository.name,
            prNumber: payload.issue.number,
            triggeredBy: payload.sender.login,
            installationId: payload.installation?.id,
            repoUrl: payload.repository.clone_url,
            instructions: instructions || undefined,
          };

          const queuedJobEntry = await jobQueue.addJob(prUpdateJob);

          logger.info(
            { jobId: queuedJobEntry.id, eventName, action: eventAction },
            'PrUpdateJob event queued',
          );
          return c.json({ success: true, jobId: queuedJobEntry.id });
        } else {
          // This is a regular issue - create IssueToPrJob
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
            'IssueToPrJob event queued',
          );
          return c.json({ success: true, jobId: queuedJobEntry.id });
        }
      }
    }

    logger.info(
      { deliveryId, eventName, action: eventAction },
      'Webhook event not suitable for queueing (no mention, unsupported action, or missing data).',
    );
    return c.json({
      success: true,
      processed: false,
      message: 'Event not queued for processing.',
    });
  } catch (error) {
    logger.error({ error: error }, 'Error processing webhook');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export const webhookRouter = router;
