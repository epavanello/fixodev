import { Octokit } from '@octokit/rest';
import { Endpoints } from '@octokit/types'; // For precise API endpoint types
import { jobQueue } from '../queue';
import { envConfig } from '../config/env';
import { logger as rootLogger } from '../config/logger';
import { Issue, IssueComment } from '@octokit/webhooks-types';
import { isBotMentioned } from '@/utils/mention';
import { IssueToPrJob } from '@/types/jobs';

const POLLER_INTERVAL_MS = 60 * 1000; // 1 minute

const logger = rootLogger.child({ service: 'NotificationPoller' });

let lastSuccessfulPollTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // Start 5 mins ago
let isPolling = false;

export type GitHubNotificationArray = Endpoints['GET /notifications']['response']['data'];
export type GitHubNotification = GitHubNotificationArray[number];

export async function processGitHubNotifications(
  notifications: GitHubNotificationArray,
  octokit: Octokit,
  testJob: boolean = false,
) {
  let successCount = 0;
  let failCount = 0;

  if (notifications.length > 0) {
    logger.info({ count: notifications.length }, 'Processing GitHub notifications array');
  }

  for (const notification of notifications) {
    try {
      if (
        notification.reason !== 'mention' ||
        !notification.subject ||
        notification.subject.type !== 'Issue' || // Only process Issue mentions for now
        !notification.repository ||
        notification.repository.private // Skip private repos (original logic)
      ) {
        // Mark as read and continue if not suitable for processing
        // Ensure notification.id is a string for parseInt, though SDK types it as string.
        await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
        continue;
      }

      const issueResponse = await octokit.request<Issue>({
        method: 'GET',
        url: notification.subject.url,
      });
      const issue = issueResponse.data;

      const commentResponse = await octokit.request<IssueComment>({
        method: 'GET',
        url: notification.subject.latest_comment_url,
      });
      const comment = commentResponse.data;

      if (!issue || !issue.number || isNaN(issue.number) || !issue.user?.login) {
        logger.error(
          { notificationId: notification.id, subjectUrl: notification.subject.url },
          'Could not determine issue details or issue number from notification subject URL response.',
        );
        if (!testJob) {
          await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
        }
        failCount++;
        continue;
      }

      // Check if bot is mentioned in issue body or comment
      const isMentionedInIssue = isBotMentioned(issue.body, issue.user.login);
      const isMentionedInComment = comment && isBotMentioned(comment.body, comment.user.login);

      if (!isMentionedInIssue && !isMentionedInComment) {
        logger.info(
          { notificationId: notification.id, issueNumber: issue.number },
          'Notification not processed: bot not mentioned in issue body or comment.',
        );
        await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
        continue;
      }

      // Determine the correct user login based on where the bot is mentioned
      let triggeredBy: string;
      if (isMentionedInComment && comment) {
        // If mentioned in comment, use comment author
        triggeredBy = comment.user.login;
        logger.info(
          { notificationId: notification.id, issueNumber: issue.number, triggeredBy },
          'Bot mentioned in comment, using comment author as trigger.',
        );
      } else {
        // If mentioned in issue body, use issue author
        triggeredBy = issue.user.login;
        logger.info(
          { notificationId: notification.id, issueNumber: issue.number, triggeredBy },
          'Bot mentioned in issue body, using issue author as trigger.',
        );
      }

      const issueToPrJob: IssueToPrJob = {
        type: 'issue_to_pr',
        id: `polled_mention_${notification.id}_${Date.now()}`,
        repoOwner: notification.repository.owner.login,
        repoName: notification.repository.name,
        issueNumber: issue.number,
        issue: issue,
        triggeredBy: triggeredBy,
        repoUrl: notification.repository.html_url,
        testJob: testJob,
      };

      await jobQueue.addJob(issueToPrJob);
      logger.info(
        {
          jobId: issueToPrJob.id,
          repo: notification.repository.full_name,
          issue: issue.number,
        },
        'IssueToPrJob queued from notification.',
      );
      await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
      successCount++;
    } catch (error) {
      logger.error(
        { notificationId: notification.id, error: error },
        'Failed to process individual notification, fetch subject details, or queue job.',
      );
      // Attempt to mark as read even if processing failed to avoid loop, but log error
      try {
        await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
      } catch (markReadError) {
        logger.error(
          { notificationId: notification.id, markReadError },
          'Failed to mark errored notification as read.',
        );
      }
      failCount++;
    }
  }
  return { successCount, failCount };
}

async function fetchAndProcessLiveNotifications(octokit: Octokit) {
  if (isPolling) {
    logger.debug('Polling already in progress. Skipping this cycle.');
    return;
  }
  isPolling = true;

  logger.info({ lastPolled: lastSuccessfulPollTimestamp }, 'Polling for new live notifications...');

  try {
    const response = await octokit.activity.listNotificationsForAuthenticatedUser({
      all: true,
      participating: false,
      since: lastSuccessfulPollTimestamp,
    });

    const notifications: GitHubNotificationArray = response.data;
    if (notifications.length > 0) {
      logger.info({ count: notifications.length }, 'Fetched new live notifications.');
      await processGitHubNotifications(notifications, octokit);
    }
    lastSuccessfulPollTimestamp = new Date().toISOString();
  } catch (error) {
    logger.error({ error: error }, 'Error during live notification polling process.');
  } finally {
    isPolling = false;
  }
}

export function startNotificationPolling() {
  if (!envConfig.BOT_USER_PAT || !envConfig.BOT_NAME) {
    logger.warn('BOT_USER_PAT or BOT_NAME not configured. User mention polling disabled.');
    return;
  }
  logger.info(`Initializing GitHub Notification Poller for user @${envConfig.BOT_NAME}`);
  const userOctokit = new Octokit({ auth: envConfig.BOT_USER_PAT });

  // Initial poll, then set interval
  fetchAndProcessLiveNotifications(userOctokit).finally(() => {
    setInterval(() => fetchAndProcessLiveNotifications(userOctokit), POLLER_INTERVAL_MS);
  });
  logger.info(`Notification polling started. Interval: ${POLLER_INTERVAL_MS / 1000}s`);
}
