import { createTool } from './llm/tools/types';
import * as z from 'zod';
import path from 'path';
import { Command } from 'commander';
import readline from 'readline/promises';
import { createRepositoryAgent } from './llm/processor';

// Schema for the CLI's final response tool
const cliFinalResponseSchema = z.object({
  response: z.string().describe('The final response from the agent to be displayed to the user.'),
});

// This tool is passed to agent.run() as the 'outputTool'.
// Its 'execute' method's return value becomes the return value of agent.run().
const cliFinalResponseTool = createTool({
  name: 'cli_final_response_tool',
  description: "Captures the agent's final response and returns it to the CLI.",
  schema: cliFinalResponseSchema,
  execute: async args => {
    // This value will be returned by agent.run()
    return args.response;
  },
});

async function runAgent(userInput: string) {
  const agent = createRepositoryAgent(path.resolve(process.cwd()), {
    conversationalLogging: true,
  });

  try {
    const finalResponse = await agent.run(userInput, {
      outputTool: cliFinalResponseTool,
      toolChoice: 'required',
    });

    if (finalResponse !== undefined) {
      console.log("\n✅ Agent's Final Output:");
      console.log(finalResponse);
    } else {
      // This might happen if maxIterations is reached before the output tool is called
      console.warn('\n⚠️ Agent finished, but no explicit output was captured via the output tool.');
      console.warn('This could be due to reaching max iterations or an unexpected agent flow.');
    }
  } catch (error) {
    console.error('\n❌ Error running agent:', error);
    process.exit(1);
  }
}

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
      await runAgent(userInput);
    });

  await program.parseAsync(process.argv);
}

main().catch(err => {
  console.error('Unhandled error in CLI execution:', err);
  process.exit(1);
});
