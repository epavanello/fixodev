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

const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

const router = new Hono();

export async function processGitHubWebhookEvent(
  payload: OctokitWebhookEvent,
  eventName: WebhookEventName,
  deliveryId: string | undefined,
  installationId: number,
  testJob: boolean = false,
) {
  let eventAction: string | undefined;
  if ('action' in payload && payload.action) {
    eventAction = payload.action;
  }

  logger.info(
    { eventName, eventAction, deliveryId, installationId },
    'Processing GitHub Webhook Event',
  );

  const gitHubApp = new GitHubApp();

  if (
    (eventName === 'issues' && isIssueEvent(payload) && payload.action === 'opened') ||
    (eventName === 'issue_comment' && isIssueCommentEvent(payload) && payload.action === 'created')
  ) {
    if (!payload.sender) {
      logger.error({ payload }, 'Webhook event not suitable for queueing (no repository).');
      return {
        success: true,
        queued: false,
      };
    }

    const octokit = await gitHubApp.getAuthenticatedClient(installationId);

    const instructions = isIssueCommentEvent(payload) ? payload.comment.body : payload.issue.body;

    const shouldProcess = isBotMentioned(instructions, payload.sender.login);

    if (shouldProcess) {
      const repoOwner = payload.repository.owner.login;
      const repoName = payload.repository.name;
      const repoUrl = payload.repository.clone_url;

      // Check if this is a comment on a PR (GitHub treats PR comments as issue comments)
      if (isIssueCommentEvent(payload) && isPullRequestComment(payload)) {
        const pr = await getPullRequest(octokit, repoOwner, repoName, payload.issue.number);

        const prUpdateJob: PrUpdateJob = {
          type: 'pr_update',
          id: deliveryId || `pr_update_${Date.now()}`,
          pullRequest: pr,
          repoOwner,
          repoName,
          prNumber: payload.issue.number,
          triggeredBy: payload.sender.login,
          installationId,
          repoUrl,
          instructions: instructions || undefined,
          testJob,
        };

        const queuedJobEntry = await jobQueue.addJob(prUpdateJob);
        logger.info(
          { jobId: queuedJobEntry.id, eventName, action: eventAction },
          'PrUpdateJob event queued',
        );
        return { success: true, jobId: queuedJobEntry.id, queued: true };
      } else {
        // This is a regular issue or a comment on a regular issue
        const jobToQueue: IssueToPrJob = {
          type: 'issue_to_pr',
          id: deliveryId || `issue_to_pr_${Date.now()}`,
          issue: payload.issue,
          repoOwner,
          repoName,
          issueNumber: payload.issue.number,
          triggeredBy: payload.sender.login,
          installationId,
          repoUrl,
          testJob,
        };

        const queuedJobEntry = await jobQueue.addJob(jobToQueue);
        logger.info(
          { jobId: queuedJobEntry.id, eventName, action: eventAction },
          'IssueToPrJob event queued',
        );
        return { success: true, jobId: queuedJobEntry.id, queued: true };
      }
    }
  }

  logger.info(
    { deliveryId, eventName, action: eventAction },
    'Webhook event not suitable for queueing (no mention, unsupported action, or missing data).',
  );
  return {
    success: true,
    queued: false,
    message: 'Event not queued for processing.',
  };
}
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
    if (!deliveryId) {
      logger.warn('Missing X-GitHub-Delivery header');
    }

    const rawBody = await c.req.text();
    const isValid = await webhooks.verify(rawBody, signature);

    if (!isValid) {
      return c.json({ error: 'Invalid webhook signature' }, 400);
    }

    const payload = JSON.parse(rawBody) as OctokitWebhookEvent;
    const currentInstallationId = 'installation' in payload && payload.installation?.id;

    if (!currentInstallationId) {
      logger.error({ deliveryId, eventName }, 'Installation ID is undefined.');
      return c.json(
        { error: 'Internal server error: Installation ID not resolved for processing.' },
        500,
      );
    }

    const result = await processGitHubWebhookEvent(
      payload,
      eventName,
      deliveryId || `webhook_${eventName}_${Date.now()}`,
      currentInstallationId,
    );

    if (result.queued) {
      return c.json({ success: result.success, jobId: result.jobId });
    } else {
      return c.json({ success: result.success, queued: false, message: result.message });
    }
  } catch (error) {
    logger.error({ error: error }, 'Error processing webhook');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export const webhookRouter = router;
