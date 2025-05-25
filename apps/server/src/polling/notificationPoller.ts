import { Octokit } from '@octokit/rest';
import { jobQueue } from '../queue';
import { UserMentionOnIssueJob } from '../types/jobs';
import { envConfig } from '../config/env';
import { logger as rootLogger } from '../config/logger';
import { Issue, PullRequest } from '@octokit/webhooks-types';

const POLLER_INTERVAL_MS = 60 * 1000; // 1 minute
const BOT_USER_MENTION = `@${envConfig.BOT_NAME}`.toLowerCase();
const logger = rootLogger.child({ service: 'NotificationPoller' });

let lastSuccessfulPollTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Start 5 mins ago
let isPolling = false;

async function fetchAndProcessNotifications(octokit: Octokit) {
  if (isPolling) {
    logger.debug('Polling already in progress. Skipping this cycle.');
    return;
  }
  isPolling = true;

  logger.info({ lastPolled: lastSuccessfulPollTimestamp }, 'Polling for new notifications...');

  try {
    const response = await octokit.activity.listNotificationsForAuthenticatedUser({
      all: true,
      participating: false,
      since: lastSuccessfulPollTimestamp,
    });

    const notifications = response.data;
    if (notifications.length > 0) {
      logger.info({ count: notifications.length }, 'Fetched new notifications.');
    }

    for (const notification of notifications) {
      if (
        notification.reason !== 'mention' ||
        !notification.subject ||
        !notification.repository ||
        notification.repository.private
      ) {
        await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
        continue;
      }

      try {
        const subjectDetailsResponse = await octokit.request<Issue | PullRequest>({
          method: 'GET',
          url: notification.subject.url,
        });
        const subjectData = subjectDetailsResponse.data;

        const commandBody = subjectData.body;
        if (
          !commandBody ||
          !commandBody.toLowerCase().includes(BOT_USER_MENTION) ||
          subjectData.user?.login.toLowerCase() === `${envConfig.BOT_NAME.toLowerCase()}` ||
          subjectData.user?.login.toLowerCase() === `${envConfig.BOT_NAME.toLowerCase()}[bot]`
        ) {
          // Mark as read even if not a command for us, to clear notification
          await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
          continue;
        }

        let eventIssueNumber: number | undefined;
        if (notification.subject.type === 'Issue') {
          eventIssueNumber = subjectData.number;
        } else if (notification.subject.type === 'PullRequest') {
          eventIssueNumber = subjectData.number;
        }

        if (!eventIssueNumber || isNaN(eventIssueNumber)) {
          logger.error(
            { notificationId: notification.id, subjectUrl: notification.subject.url },
            'Could not determine issue/PR number from notification.',
          );
          await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
          continue;
        }

        const userMentionJob: UserMentionOnIssueJob = {
          id: `user_mention_${notification.id}_${Date.now()}`,
          type: 'user_mention',
          originalRepoOwner: notification.repository.owner.login,
          originalRepoName: notification.repository.name,
          eventIssueNumber: eventIssueNumber,
          eventIssueTitle:
            notification.subject.title || `Mention in ${notification.repository.full_name}`,
          commandToProcess: commandBody,
          triggeredBy: subjectData.user?.login || 'unknown_user',
        };

        await jobQueue.addJob(userMentionJob);
        logger.info(
          {
            jobId: userMentionJob.id,
            repo: notification.repository.full_name,
            issue: eventIssueNumber,
          },
          'UserMentionJob queued.',
        );

        await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
      } catch (error) {
        logger.error(
          { notificationId: notification.id, error: error },
          'Failed to process individual notification or fetch subject details.',
        );
        await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
      }
    }
    lastSuccessfulPollTimestamp = new Date().toISOString();
  } catch (error) {
    logger.error({ error: error }, 'Error during notification polling process.');
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
  fetchAndProcessNotifications(userOctokit).finally(() => {
    setInterval(() => fetchAndProcessNotifications(userOctokit), POLLER_INTERVAL_MS);
  });
  logger.info(`Notification polling started. Interval: ${POLLER_INTERVAL_MS / 1000}s`);
}
