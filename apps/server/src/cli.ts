import path from 'path';
import fs from 'fs/promises';
import { Command } from 'commander';
import readline from 'readline/promises';
import { Octokit } from '@octokit/rest';
import { processCodeModificationRequest } from './llm/processor';
import { loadBotConfig } from './utils/yaml';
import { taskCompletionTool } from './llm/tools/task';
import { jobQueue } from './queue';
import { getIssue } from './github/issue';
import { envConfig } from './config/env';
import { parseGitHubIssueUrl } from './utils/github';
import { GitHubApp } from './github/app';
import { WebhookEventName, WebhookEvent as OctokitWebhookEvent } from '@octokit/webhooks-types';
import { processGitHubWebhookEvent } from './routes/webhook';
import { GitHubNotificationArray, processGitHubNotifications } from './polling/notificationPoller';
import { logger } from './config/logger';

async function main() {
  const program = new Command();

  program
    .name('agent-cli')
    .description('CLI to interact with the AI agent.')
    .argument('[prompt]', 'The initial prompt for the agent')
    .action(async (prompt: string | undefined) => {
      let userInput = prompt;
      if (!userInput) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        userInput = await rl.question('🤖 How can I assist you today? ');
        rl.close();
      }

      if (!userInput || userInput.trim() === '') {
        console.error('🔴 No input provided. Exiting.');
        process.exit(1);
      }

      const result = await processCodeModificationRequest(
        userInput,
        path.resolve(process.cwd(), '..', 'cheatgpt_new'),
        await loadBotConfig(path.resolve(process.cwd())),
        true,
        taskCompletionTool,
      );

      if (!result?.output?.objectiveAchieved) {
        console.warn(`\n⚠️ Agent finished, reason: ${result?.output?.reasonOrOutput}.`);
      }
    });

  program
    .command('issue-to-pr')
    .description('Process an issue to a PR')
    .argument('[issue-url]', 'The URL of the issue to process')
    .option('-i, --installation-id <id>', 'The installation ID of the GitHub App', (id: string) =>
      isNaN(parseInt(id)) ? undefined : parseInt(id),
    )
    .action(async (issueUrl: string | undefined, options: { installationId?: number }) => {
      if (!issueUrl) {
        console.error('🔴 No issue URL provided. Exiting.');
        process.exit(1);
      }

      const installationId = options.installationId || envConfig.DEBUG_INSTALLATION_ID;

      if (!envConfig.BOT_USER_PAT && !options.installationId) {
        console.error('🔴 Either BOT_USER_PAT or --installation-id must be provided. Exiting.');
        process.exit(1);
      }

      let octokit: Octokit;
      if (installationId) {
        const app = new GitHubApp();
        octokit = await app.getAuthenticatedClient(installationId);
      } else {
        octokit = new Octokit({ auth: envConfig.BOT_USER_PAT });
      }

      console.log(`🔍 Fetching issue from: ${issueUrl}`);
      const issue = await getIssue(octokit, issueUrl);
      const { owner: repoOwner, repo: repoName } = parseGitHubIssueUrl(issueUrl);
      const repoUrl = `https://github.com/${repoOwner}/${repoName}.git`;
      console.log(`📝 Creating job for issue #${issue.number} in ${repoOwner}/${repoName}`);
      const job = await jobQueue.addJob({
        type: 'issue_to_pr',
        id: `cli_issue_to_pr_${Date.now()}`,
        issueNumber: issue.number,
        triggeredBy: issue.user?.login || 'cli-user',
        issue: issue,
        repoOwner: repoOwner,
        repoName: repoName,
        repoUrl: repoUrl,
        testJob: true,
        installationId,
      });
      console.log(`✅ Job created successfully with ID: ${job.id}`);
      console.log(`🚀 The job will be processed automatically. Check the logs for progress.`);
    });

  program
    .command('debug-webhook')
    .description('Debug a GitHub webhook event from a local JSON file.')
    .argument('<event-name>', 'The X-GitHub-Event name (e.g., issues, issue_comment)')
    .argument('<payload-file-path>', 'Path to the JSON file containing the webhook payload')
    .option('-i, --installation-id <id>', 'The installation ID for the GitHub App', (id: string) =>
      isNaN(parseInt(id)) ? undefined : parseInt(id),
    )
    .option(
      '--delivery-id <id>',
      'The X-GitHub-Delivery ID (simulated)',
      `debug-webhook-${Date.now()}`,
    )
    .option('--test', 'Mark the created job as a test job', false)
    .action(
      async (
        eventName: WebhookEventName,
        payloadFilePath: string,
        options: { installationId?: number; deliveryId: string; test: boolean },
      ) => {
        const installationId = options.installationId || envConfig.DEBUG_INSTALLATION_ID;

        if (!installationId) {
          console.error(
            '🔴 Missing --installation-id and DEBUG_INSTALLATION_ID not set or invalid in .env. Exiting.',
          );
          logger.error(
            'Missing --installation-id for debug-webhook and DEBUG_INSTALLATION_ID not available/valid.',
          );
          process.exit(1);
        }

        const payloadFileContent = await fs.readFile(path.resolve(payloadFilePath), 'utf-8');
        // Rely on the processing function to validate the payload structure after casting
        const payload = JSON.parse(payloadFileContent) as OctokitWebhookEvent;

        console.log(`⚙️ Processing webhook event '${eventName}' from ${payloadFilePath}`);
        logger.info({ eventName, payloadFilePath, options }, 'Starting debug-webhook processing');

        const result = await processGitHubWebhookEvent(
          payload,
          eventName,
          options.deliveryId,
          installationId,
          options.test,
        );

        if (result.queued && result.jobId) {
          console.log(`✅ Webhook event processed. Job ID: ${result.jobId}`);
          logger.info({ jobId: result.jobId }, 'debug-webhook job queued');
        } else {
          console.warn(
            `⚠️ Webhook event not queued. Message: ${result.message || 'No specific message.'}`,
          );
          logger.warn({ result }, 'debug-webhook event not queued');
        }
      },
    );

  program
    .command('debug-notification')
    .description(
      'Debug GitHub notification events from a local JSON file (array of raw notification objects).',
    )
    .argument(
      '<payload-file-path>',
      'Path to the JSON file containing an array of raw GitHub notification objects. `subject.url` must be fetchable.',
    )
    .option('--test', 'Mark the created job(s) as a test job', false)
    .action(async (payloadFilePath: string, options: { test: boolean }) => {
      if (!envConfig.BOT_USER_PAT) {
        console.error('🔴 BOT_USER_PAT must be configured in .env for notification debugging.');
        logger.error('BOT_USER_PAT not configured for debug-notification');
        process.exit(1);
      }

      const payloadFileContent = await fs.readFile(path.resolve(payloadFilePath), 'utf-8');
      // Directly cast the parsed JSON. Relies on processGitHubNotifications for handling structure.
      const notificationsPayload = JSON.parse(payloadFileContent) as GitHubNotificationArray;

      if (!Array.isArray(notificationsPayload)) {
        // Minimal check for array type, as processGitHubNotifications expects an array.
        console.error('🔴 Payload file must contain a JSON array of notifications.');
        logger.error('Payload for debug-notification is not an array.', { payloadFilePath });
        process.exit(1);
      }

      console.log(
        `⚙️ Processing ${notificationsPayload.length} notification(s) from ${payloadFilePath}`,
      );
      logger.info(
        { payloadFilePath, options, count: notificationsPayload.length },
        'Starting debug-notification processing',
      );

      const { successCount, failCount } = await processGitHubNotifications(
        notificationsPayload,
        new Octokit({ auth: envConfig.BOT_USER_PAT }), // Create Octokit instance here
        options.test,
      );

      console.log(`
🏁 Debug notification processing finished.
Total in file: ${notificationsPayload.length}, Succeeded: ${successCount}, Failed/Skipped: ${failCount}
        `);
      logger.info(
        { successCount, failCount, totalInFile: notificationsPayload.length },
        'debug-notification array processing complete',
      );
    });

  await program.parseAsync(process.argv);
}

main().catch(err => {
  console.error('Unhandled error in CLI execution:', err);
  process.exit(1);
});
