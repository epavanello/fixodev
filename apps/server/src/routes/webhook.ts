import { Hono } from 'hono';
import { logger } from '../config/logger';
import { jobQueue } from '../queue';
import { Webhooks } from '@octokit/webhooks';
import { envConfig } from '../config/env';
import { AppMentionOnIssueJob, AppMentionOnPullRequestJob, JobType } from '../types/jobs';
import { WebhookEventName, WebhookEvent as OctokitWebhookEvent } from '@octokit/webhooks-types';
import { isIssueCommentEvent, isIssueEvent, isPullRequestReviewCommentEvent } from '@/types/guards';

const BOT_MENTION = `@${envConfig.BOT_NAME}`.toLowerCase();

// Initialize webhooks instance
const webhooks = new Webhooks({
  secret: envConfig.GITHUB_WEBHOOK_SECRET,
});

const router = new Hono();

/**
 * Checks if the bot is mentioned in the body and extracts the command.
 */
function getBotCommandFromPayload(body: string | null | undefined): {
  shouldProcess: boolean;
  command?: string;
} {
  if (!body) {
    return { shouldProcess: false };
  }
  if (body.toLowerCase().includes(BOT_MENTION)) {
    return { shouldProcess: true, command: body };
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
    let issueNumber: number | undefined;
    let issueTitle: string | undefined;
    let pullRequestNumber: number | undefined;
    let pullRequestTitle: string | undefined;
    let pullRequestUrl: string | undefined;
    let headRef: string | undefined;
    let headSha: string | undefined;
    let baseRef: string | undefined;
    let baseSha: string | undefined;
    let commentId: number | undefined;
    let repoOwner: string | undefined;
    let repoName: string | undefined;
    let repositoryUrl: string | undefined;
    let installationId: number | undefined;
    let senderLogin: string | undefined;
    let shouldProcessEvent = false;
    let jobType: JobType | undefined;

    if (eventName === 'issues' && isIssueEvent(payload) && payload.action === 'opened') {
      const issuePayload = payload;
      const { shouldProcess, command } = getBotCommandFromPayload(issuePayload.issue.body);
      if (shouldProcess && command) {
        commandToProcess = command;
        issueNumber = issuePayload.issue.number;
        issueTitle = issuePayload.issue.title;
        repoOwner = issuePayload.repository.owner.login;
        repoName = issuePayload.repository.name;
        repositoryUrl = issuePayload.repository.clone_url;
        installationId = issuePayload.installation?.id;
        senderLogin = issuePayload.sender.login;
        shouldProcessEvent = true;
        jobType = JobType.AppMention;
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
      // Ensure it's not a comment made by the bot itself to avoid loops
      if (
        commentPayload.sender.login.toLowerCase() === envConfig.BOT_NAME.toLowerCase() ||
        commentPayload.sender.login.toLowerCase() === `${envConfig.BOT_NAME}[bot]`.toLowerCase()
      ) {
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
        issueNumber = commentPayload.issue.number;
        issueTitle = commentPayload.issue.title;
        repoOwner = commentPayload.repository.owner.login;
        repoName = commentPayload.repository.name;
        repositoryUrl = commentPayload.repository.clone_url;
        installationId = commentPayload.installation?.id;
        senderLogin = commentPayload.sender.login;
        shouldProcessEvent = true;
        jobType = JobType.AppMention;
        logger.info(
          { deliveryId, eventName, repo: `${repoOwner}/${repoName}`, issue: issueNumber },
          'Processing mention from issue comment',
        );
      }
    } else if (
      eventName === 'pull_request_review_comment' &&
      isPullRequestReviewCommentEvent(payload) &&
      payload.action === 'created'
    ) {
      const prCommentPayload = payload;
      // Ensure it's not a comment made by the bot itself to avoid loops
      if (
        prCommentPayload.sender.login.toLowerCase() === envConfig.BOT_NAME.toLowerCase() ||
        prCommentPayload.sender.login.toLowerCase() === `${envConfig.BOT_NAME}[bot]`.toLowerCase()
      ) {
        logger.info(
          {
            deliveryId,
            eventName,
            repo: `${prCommentPayload.repository.owner.login}/${prCommentPayload.repository.name}`,
            pull_request: prCommentPayload.pull_request.number,
          },
          'Skipping comment from bot itself.',
        );
        return c.json({
          success: true,
          processed: false,
          message: 'Skipping comment from bot itself.',
        });
      }

      const { shouldProcess, command } = getBotCommandFromPayload(prCommentPayload.comment.body);
      if (shouldProcess && command) {
        commandToProcess = command;
        pullRequestNumber = prCommentPayload.pull_request.number;
        pullRequestTitle = prCommentPayload.pull_request.title;
        pullRequestUrl = prCommentPayload.pull_request.url;
        headRef = prCommentPayload.pull_request.head.ref;
        headSha = prCommentPayload.pull_request.head.sha;
        baseRef = prCommentPayload.pull_request.base.ref;
        baseSha = prCommentPayload.pull_request.base.sha;
        commentId = prCommentPayload.comment.id;
        repoOwner = prCommentPayload.repository.owner.login;
        repoName = prCommentPayload.repository.name;
        repositoryUrl = prCommentPayload.repository.clone_url;
        installationId = prCommentPayload.installation?.id;
        senderLogin = prCommentPayload.sender.login;
        shouldProcessEvent = true;
        jobType = JobType.AppMentionOnPullRequest;
        logger.info(
          { deliveryId, eventName, repo: `${repoOwner}/${repoName}`, pull_request: pullRequestNumber },
          'Processing mention from pull request review comment',
        );
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
      jobType
    ) {
      if (jobType === JobType.AppMention && issueNumber && issueTitle) {
        const jobToQueue: AppMentionOnIssueJob = {
          id: deliveryId || `app_mention_${Date.now()}`,
          type: JobType.AppMention,
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
      } else if (
        jobType === JobType.AppMentionOnPullRequest &&
        pullRequestNumber &&
        pullRequestTitle &&
        pullRequestUrl &&
        headRef &&
        headSha &&
        baseRef &&
        baseSha &&
        commentId
      ) {
        const jobToQueue: AppMentionOnPullRequestJob = {
          id: deliveryId || `app_mention_pr_${Date.now()}`,
          type: JobType.AppMentionOnPullRequest,
          originalRepoOwner: repoOwner,
          originalRepoName: repoName,
          eventPullRequestNumber: pullRequestNumber,
          eventPullRequestTitle: pullRequestTitle,
          pullRequestUrl: pullRequestUrl,
          headRef: headRef,
          headSha: headSha,
          baseRef: baseRef,
          baseSha: baseSha,
          commentId: commentId,
          commandToProcess: commandToProcess,
          triggeredBy: senderLogin,
          installationId: installationId,
          repositoryUrl: repositoryUrl,
        };
        const queuedJobEntry = await jobQueue.addJob(jobToQueue);

        logger.info(
          { jobId: queuedJobEntry.id, eventName, action: eventAction },
          'AppMentionOnPullRequestJob event queued',
        );
        return c.json({ success: true, jobId: queuedJobEntry.id });
      }
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
