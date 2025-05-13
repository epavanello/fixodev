import * as z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Interface for all tools that can be used by the LLM agent
 */
export interface Tool<PARAMS extends z.ZodType = z.ZodType, OUTPUT = unknown> {
  /**
   * Unique name for the tool
   */
  name: string;

  /**
   * Human-readable description of what the tool does
   */
  description: string;

  /**
   * Zod schema for the tool's parameters
   */
  schema: PARAMS;

  /**
   * Method to execute the tool with validated parameters
   */
  execute: (params: z.infer<PARAMS>) => Promise<OUTPUT>;

  /**
   * Optional method to validate the result
   */
  validateResult?: (result: OUTPUT) => boolean;

  /**
   * Generate a JSON Schema for tool parameters
   */
  getParameterJSONSchema: () => Record<string, unknown>;
}

/**
 * Default tool type with unknown return type
 */
export type DefaultTool = Tool<z.ZodType, unknown>;

/**
 * Factory function to create a tool with correct typing
 */
export function createTool<PARAMS extends z.ZodType, OUTPUT>(config: {
  name: string;
  description: string;
  schema: PARAMS;
  execute: (params: z.infer<PARAMS>) => Promise<OUTPUT>;
  validateResult?: (result: OUTPUT) => boolean;
}): Tool<PARAMS, OUTPUT> {
  return {
    ...config,
    getParameterJSONSchema: () => zodToJsonSchema(config.schema),
  };
}
