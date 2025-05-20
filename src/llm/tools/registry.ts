import * as z from 'zod';
import { ToolContext, WrappedTool } from './types';
import { ToolSet } from 'ai';

/**
 * Registry for managing tools available to the LLM agent
 */
export class ToolRegistry {
  private tools = new Map<string, WrappedTool<any, any>>();
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
  }

  /**
   * Register a new tool in the registry
   */
  register<PARAMS extends z.ZodType, OUTPUT>(tool: WrappedTool<PARAMS, OUTPUT>): this {
    if (this.tools.has(tool.name)) {
      return this;
    }

    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Get a tool by name
   */
  get(name: string): WrappedTool | undefined {
    return this.tools.get(name) as WrappedTool | undefined;
  }

  /**
   * Remove a tool from the registry
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): WrappedTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all registered tools in the format expected by the AI SDK
   */
  getUnwrappedTools(): ToolSet {
    return this.getAllTools().reduce((acc, wrappedTool) => {
      const { name, description, parameters, execute } = wrappedTool;
      acc[name] = {
        description,
        parameters,
        execute: (...args) => {
          return execute(...args, this.context);
        },
      };
      return acc;
    }, {} as ToolSet);
  }
}
