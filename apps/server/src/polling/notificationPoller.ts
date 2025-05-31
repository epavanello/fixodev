import { Octokit } from '@octokit/rest';
import { jobQueue } from '../queue';
import { envConfig } from '../config/env';
import { logger as rootLogger } from '../config/logger';
import { Issue } from '@octokit/webhooks-types';
import { isBotMentioned } from '@/utils/mention';
import { IssueToPrJob } from '@/types/jobs';

const POLLER_INTERVAL_MS = 60 * 1000; // 1 minute

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
        notification.subject.type !== 'Issue' ||
        !notification.repository ||
        // must have app installed
        notification.repository.private
      ) {
        await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
        continue;
      }

      try {
        const issueResponse = await octokit.request<Issue>({
          method: 'GET',
          url: notification.subject.url,
        });
        const issue = issueResponse.data;

        const shouldProcess = isBotMentioned(issue.body, issue.user?.login);
        if (!shouldProcess) {
          // Mark as read even if not a command for us, to clear notification
          await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
          continue;
        }

        if (!issue.number || isNaN(issue.number)) {
          logger.error(
            { notificationId: notification.id, subjectUrl: notification.subject.url },
            'Could not determine issue/PR number from notification.',
          );
          await octokit.activity.markThreadAsRead({ thread_id: parseInt(notification.id) });
          continue;
        }

        const issueToPrJob: IssueToPrJob = {
          type: 'issue_to_pr',
          id: `user_mention_${notification.id}_${Date.now()}`,
          repoOwner: notification.repository.owner.login,
          repoName: notification.repository.name,
          issueNumber: issue.number,
          issue: issue,
          triggeredBy: issue.user?.login || 'unknown_user',
          repoUrl: notification.repository.html_url,
        };

        await jobQueue.addJob(issueToPrJob);
        logger.info(
          {
            jobId: issueToPrJob.id,
            repo: notification.repository.full_name,
            issue: issue.number,
          },
          'IssueToPrJob queued.',
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
