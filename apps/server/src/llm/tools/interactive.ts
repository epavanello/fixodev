import * as z from 'zod';
import { wrapTool } from './types';
import readline from 'readline/promises';

const askUserSchema = z.object({
  question: z.string().describe('The question to ask the human user.'),
});
export const askUserTool = wrapTool({
  name: 'ask_user_tool',
  description:
    "Asks the human user a clarifying question and returns their answer. Use this if you need more information or clarification from the user to proceed with the task, or to confirm an action before taking it. Only use this tool if conversational logging is enabled for the agent's CLI interaction. When a task is completed, you can use this tool to ask what else the user would like you to do.",
  schema: askUserSchema,
  execute: async ({ question }) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // Add a small prefix to distinguish agent questions clearly
    const answer = await rl.question(`🤔 Agent asks: ${question} `);
    rl.close();
    return answer;
  },
  getReadableParams: () => {
    return '';
  },
});
