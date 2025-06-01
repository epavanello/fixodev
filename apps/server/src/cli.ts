import path from 'path';
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
    .action(
      async (issueUrl: string | undefined, options: { installationId: number | undefined }) => {
        if (!issueUrl) {
          console.error('🔴 No issue URL provided. Exiting.');
          process.exit(1);
        }

        if (!envConfig.BOT_USER_PAT) {
          console.error('🔴 No BOT_USER_PAT configured. Exiting.');
          process.exit(1);
        }

        let octokit: Octokit;

        if (options.installationId) {
          const app = new GitHubApp();
          octokit = await app.getAuthenticatedClient(options.installationId);
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
          installationId: options.installationId,
        });

        console.log(`✅ Job created successfully with ID: ${job.id}`);
        console.log(`🚀 The job will be processed automatically. Check the logs for progress.`);
      },
    );

  await program.parseAsync(process.argv);
}

main().catch(err => {
  console.error('Unhandled error in CLI execution:', err);
  process.exit(1);
});
