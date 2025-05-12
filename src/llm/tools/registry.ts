import * as z from 'zod';
import { Tool } from './types';

/**
 * Registry for managing tools available to the LLM agent
 */
export class ToolRegistry {
  private tools: Map<string, Tool<any, any>> = new Map();

  /**
   * Register a new tool in the registry
   */
  register<T extends z.ZodType, R>(tool: Tool<T, R>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name "${tool.name}" is already registered`);
    }

    this.tools.set(tool.name, tool as Tool<any, any>);
    return this;
  }

  /**
   * Get a tool by name
   */
  get<T extends z.ZodType, R>(name: string): Tool<T, R> | undefined {
    return this.tools.get(name) as Tool<T, R> | undefined;
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
  getAllTools(): Tool<any, any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get JSON schema for all registered tools
   */
  getToolsJSONSchema(): Record<string, any>[] {
    return this.getAllTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.getParameterJSONSchema(),
    }));
  }

  /**
   * Execute a tool by name with provided parameters
   */
  async execute<R>(name: string, params: any): Promise<R> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }

    // Validate parameters against the tool's schema
    const validatedParams = tool.schema.parse(params);

    // Execute the tool with validated parameters
    return tool.execute(validatedParams) as Promise<R>;
  }
}
