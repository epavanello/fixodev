import { z } from 'zod';
import { wrapTool } from './types';

/**
 * A tool that allows the agent to think about the task and the objective
 */
export const thinkTool = wrapTool({
  name: 'think',
  description: 'Think about the task and the objective. Mandatory before any other tool is called.',
  schema: z.object({
    thought: z.string().describe('A thought about the task and the objective'),
  }),
  execute: async params => {
    return {
      thought: params.thought,
    };
  },
});
