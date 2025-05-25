import { CoreToolMessage, ToolExecutionOptions } from 'ai';
import * as z from 'zod';

export type ToolParameters = z.ZodTypeAny | z.Schema<any>;

export type ToolContext = {
  basePath: string;
};

/**
 * Factory function to create a tool with correct typing
 */
export function wrapTool<PARAMS extends ToolParameters = any, OUTPUT = any>(config: {
  name: string;
  description: string;
  schema: PARAMS;
  execute: (
    params: z.infer<PARAMS>,
    options?: ToolExecutionOptions,
    context?: ToolContext,
  ) => Promise<OUTPUT>;
  getReadableParams?: (params: z.infer<PARAMS>) => string;
  getReadableResult?: (result: OUTPUT) => string;
  transformToolResponse?: (
    original: CoreToolMessage,
    info: { toolCallsCount: number },
  ) => CoreToolMessage;
}) {
  return {
    name: config.name,
    execute: config.execute,
    description: config.description,
    parameters: config.schema,
    getReadableParams: config.getReadableParams,
    getReadableResult: config.getReadableResult,
    transformToolResponse: config.transformToolResponse,
  };
}

export type WrappedTool<PARAMS extends ToolParameters = any, OUTPUT = any> = ReturnType<
  typeof wrapTool<PARAMS, OUTPUT>
>;
