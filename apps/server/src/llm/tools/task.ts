import { z } from 'zod';
import { wrapTool } from './types';

/**
 * A task completion tool that allows the agent to signal when a task is complete
 */
export const taskCompletionTool = wrapTool({
  name: 'taskCompletion',
  description: 'Signal whether the objective has been achieved or not',
  schema: z.object({
    objectiveAchieved: z.boolean().describe('Whether the objective has been successfully achieved'),
    reasonOrOutput: z
      .string()
      .describe(
        'Explanation of why the objective was or was not achieved, or the output of the task if it was successful',
      ),
  }),
  execute: async params => {
    return {
      objectiveAchieved: params.objectiveAchieved,
      reasonOrOutput: params.reasonOrOutput,
    };
  },
  getReadableResult: result => {
    return result.reasonOrOutput;
  },
});
