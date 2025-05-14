import { Agent, AgentOptions } from './llm/agent';
import { createTool } from './llm/tools/types';
import * as z from 'zod';
import path from 'path';

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

async function main() {
  // Basic command line argument parsing
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('🔴 Please provide an input prompt for the agent.');
    console.error('Usage: bun run cli <your prompt here>');
    process.exit(1);
  }
  const userInput = args.join(' ');

  const agentOptions: AgentOptions = {
    basePath: path.resolve(process.cwd()), // Use current working directory as basePath
    // You might want to customize the system message for CLI interactions
    systemMessage:
      'You are a helpful AI assistant. When you have the final answer to the user\'s query, you MUST use the "cli_final_response_tool" to provide it.',
    // Other options can be added here or exposed as CLI flags later
    // model: 'gpt-4o',
    // maxIterations: 5,
  };

  const agent = new Agent(agentOptions);

  // Note: The Agent's constructor already registers 'createTaskCompletionTool'.
  // If your agent needs other general-purpose tools for CLI mode, register them here:
  // agent.registerTool(someOtherTool);

  console.log(`💬 Running agent with input: "${userInput}"`);
  console.log('⏳ Waiting for agent response...');

  try {
    const finalResponse = await agent.run(userInput, { outputTool: cliFinalResponseTool });

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

main().catch(err => {
  console.error('Unhandled error in CLI execution:', err);
  process.exit(1);
});
