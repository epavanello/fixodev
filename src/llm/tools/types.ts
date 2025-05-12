import * as z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Represents the completion status of a task
 */
export enum TaskCompletionStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

/**
 * Interface for all tools that can be used by the LLM agent
 */
export interface Tool<T extends z.ZodType = z.ZodType, R = any> {
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
  schema: T;

  /**
   * Method to execute the tool with validated parameters
   */
  execute: (params: z.infer<T>) => Promise<R>;

  /**
   * Optional method to validate the result
   */
  validateResult?: (result: R) => boolean;

  /**
   * Generate a JSON Schema for tool parameters
   */
  getParameterJSONSchema: () => Record<string, any>;
}

/**
 * Factory function to create a tool with correct typing
 */
export function createTool<T extends z.ZodType, R>(config: {
  name: string;
  description: string;
  schema: T;
  execute: (params: z.infer<T>) => Promise<R>;
  validateResult?: (result: R) => boolean;
}): Tool<T, R> {
  return {
    ...config,
    getParameterJSONSchema: () => zodToJsonSchema(config.schema),
  };
}
