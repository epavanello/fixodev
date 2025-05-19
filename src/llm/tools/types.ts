import { logger } from '@/config/logger';
import { tool, ToolExecutionOptions } from 'ai';
import * as z from 'zod';

export type ToolParameters = z.ZodTypeAny | z.Schema<any>;

/**
 * Factory function to create a tool with correct typing
 */
export function wrapTool<PARAMS extends ToolParameters = any, OUTPUT = any>(config: {
  name: string;
  description: string;
  schema: PARAMS;
  execute: (args: z.infer<PARAMS>, options?: ToolExecutionOptions) => Promise<OUTPUT>;
  getReadableParams?: (params: z.infer<PARAMS>) => string;
  getReadableResult?: (result: OUTPUT) => string;
}) {
  return {
    name: config.name,
    callback: config.execute,
    tool: tool({
      description: config.description,
      parameters: config.schema,
      execute: async (...args) => {
        const [params] = args;
        const result = await config.execute(...args);
        logger.info(
          `${config.name}(${
            config.getReadableParams?.(params) || JSON.stringify(params, null, 2)
          }) => ${config.getReadableResult?.(result) || JSON.stringify(result, null, 2)}`,
        );
        return result;
      },
    }),
    getReadableParams: config.getReadableParams || (params => JSON.stringify(params)),
    getReadableResult: config.getReadableResult || (result => result),
  };
}

export type WrappedTool<PARAMS extends ToolParameters = any, OUTPUT = any> = ReturnType<
  typeof wrapTool<PARAMS, OUTPUT>
>;
