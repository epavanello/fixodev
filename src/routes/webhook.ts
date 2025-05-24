import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import {
  AppMentionOnIssueJob,
  AppMentionOnPullRequestJob,
} from '../types/jobs';
import { WebhookEventName, WebhookEvent as OctokitWebhookEvent } from '@octokit/webhooks-types';
import { isIssueCommentEvent, isIssueEvent, isPullRequestCommentEvent } from '@/types/guards';

const BOT_MENTION = `@${envConfig.BOT_NAME}`.toLowerCase();

// Initialize webhooks instance
const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

const router = new Hono();

/**
 * Checks if the bot is mentioned in the body and extracts the command.
 * Returns the command without the mention.
 */
function getBotCommandFromPayload(body: string | null | undefined): {
  shouldProcess: boolean;
  command?: string;
} {
  if (!body) {
    return { shouldProcess: false };
  }
  const mentionIndex = body.toLowerCase().indexOf(BOT_MENTION);
  if (mentionIndex !== -1) {
    // Extract command after the mention, trim whitespace
    const command = body.substring(mentionIndex + BOT_MENTION.length).trim();
    return { shouldProcess: true, command: command || 'default_command' }; // Provide a default command if only mention is present
  }
  return { shouldProcess: false };
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
    let repoOwner: string | undefined;
    let repoName: string | undefined;
    let repositoryUrl: string | undefined;
    let installationId: number | undefined;
    let senderLogin: string | undefined;
    let shouldProcessEvent = false;
    let jobToQueue: AppMentionOnIssueJob | AppMentionOnPullRequestJob | undefined;

    // Helper to check if comment is from bot itself
    const isCommentFromBot = (commentSenderLogin: string) => {
      return (
        commentSenderLogin.toLowerCase() === envConfig.BOT_NAME.toLowerCase() ||
        commentSenderLogin.toLowerCase() === `${envConfig.BOT_NAME}[bot]`.toLowerCase()
      );
    };

    if (eventName === 'issues' && isIssueEvent(payload) && payload.action === 'opened') {
      const issuePayload = payload;
      const { shouldProcess, command } = getBotCommandFromPayload(issuePayload.issue.body);
      if (shouldProcess && command) {
        commandToProcess = command;
        repoOwner = issuePayload.repository.owner.login;
        repoName = issuePayload.repository.name;
        repositoryUrl = issuePayload.repository.clone_url;
        installationId = issuePayload.installation?.id;
        senderLogin = issuePayload.sender.login;
        shouldProcessEvent = true;

        jobToQueue = {
          id: deliveryId || `app_mention_issue_${Date.now()}`,
          type: 'app_mention_issue',
          originalRepoOwner: repoOwner,
          originalRepoName: repoName,
          eventIssueNumber: issuePayload.issue.number,
          eventIssueTitle: issuePayload.issue.title,
          commandToProcess: commandToProcess,
          triggeredBy: senderLogin,
          installationId: installationId,
          repositoryUrl: repositoryUrl,
        };

        logger.info(
          { deliveryId, eventName, repo: `${repoOwner}/${repoName}`, issue: issuePayload.issue.number },
          'Processing mention from new issue',
        );
      }
    } else if (
      eventName === 'issue_comment' &&
      isIssueCommentEvent(payload) &&
      payload.action === 'created'
    ) {
      const commentPayload = payload;

      if (isCommentFromBot(commentPayload.sender.login)) {
        logger.info(
          {
            deliveryId,
            eventName,
            repo: `${commentPayload.repository.owner.login}/${commentPayload.repository.name}`,
            issue: commentPayload.issue.number,
          },
          'Skipping comment from bot itself.',
        );
        return c.json({
          success: true,
          processed: false,
          message: 'Skipping comment from bot itself.',
        });
      }

      const { shouldProcess, command } = getBotCommandFromPayload(commentPayload.comment.body);

      if (shouldProcess && command) {
        commandToProcess = command;
        repoOwner = commentPayload.repository.owner.login;
        repoName = commentPayload.repository.name;
        repositoryUrl = commentPayload.repository.clone_url;
        installationId = commentPayload.installation?.id;
        senderLogin = commentPayload.sender.login;
        shouldProcessEvent = true;

        if (isPullRequestCommentEvent(commentPayload)) {
          // This is a comment on a Pull Request
          jobToQueue = {
            id: deliveryId || `app_mention_pr_${Date.now()}`,
            type: 'app_mention_pr',
            originalRepoOwner: repoOwner,
            originalRepoName: repoName,
            eventPullRequestNumber: commentPayload.issue.number, // issue.number is the PR number for PR comments
            eventPullRequestTitle: commentPayload.issue.title,
            prHeadRef: commentPayload.issue.pull_request?.head.ref || 'main', // Default to main if not found
            prHeadSha: commentPayload.issue.pull_request?.head.sha || '',
            commandToProcess: commandToProcess,
            triggeredBy: senderLogin,
            installationId: installationId,
            repositoryUrl: repositoryUrl,
          };
          logger.info(
            { deliveryId, eventName, repo: `${repoOwner}/${repoName}`, pr: commentPayload.issue.number },
            'Processing mention from pull request comment',
          );
        } else {
          // This is a comment on a regular Issue
          jobToQueue = {
            id: deliveryId || `app_mention_issue_${Date.now()}`,
            type: 'app_mention_issue',
            originalRepoOwner: repoOwner,
            originalRepoName: repoName,
            eventIssueNumber: commentPayload.issue.number,
            eventIssueTitle: commentPayload.issue.title,
            commandToProcess: commandToProcess,
            triggeredBy: senderLogin,
            installationId: installationId,
            repositoryUrl: repositoryUrl,
          };
          logger.info(
            { deliveryId, eventName, repo: `${repoOwner}/${repoName}`, issue: commentPayload.issue.number },
            'Processing mention from issue comment',
          );
        }
      }
    }

    if (
      shouldProcessEvent &&
      commandToProcess &&
      repoOwner &&
      repoName &&
      repositoryUrl &&
      installationId &&
      senderLogin &&
      jobToQueue
    ) {
      const queuedJobEntry = await jobQueue.addJob(jobToQueue);

      logger.info(
        { jobId: queuedJobEntry.id, eventName, action: eventAction, jobType: jobToQueue.type },
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
