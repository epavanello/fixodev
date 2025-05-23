import path from 'path';
import { Command } from 'commander';
import readline from 'readline/promises';
import { processCodeModificationRequest } from './llm/processor';
import { loadBotConfig } from './utils/yaml';
import { taskCompletionTool } from './llm/tools/task';

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

      try {
        const result = await processCodeModificationRequest(
          userInput,
          path.resolve(process.cwd(), '..', 'cheatgpt_new'),
          await loadBotConfig(path.resolve(process.cwd())),
          true,
          taskCompletionTool,
        );

        if (!result?.objectiveAchieved) {
          console.warn(`\n⚠️ Agent finished, reason: ${result?.reasonOrOutput}.`);
        }
      } catch (error) {
        console.error('\n❌ Error running agent:', error);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch(err => {
  console.error('Unhandled error in CLI execution:', err);
  process.exit(1);
});
