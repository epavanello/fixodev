import * as z from 'zod';
import { WrappedTool, wrapTool } from './types';
import { ToolSet } from 'ai';

/**
 * Registry for managing tools available to the LLM agent
 */
export class ToolRegistry {
  private tools = new Map<string, WrappedTool<any, any>>();

  /**
   * Register a new tool in the registry
   */
  register<PARAMS extends z.ZodType, OUTPUT>(tool: WrappedTool<PARAMS, OUTPUT>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name "${tool.name}" is already registered`);
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
      acc[wrappedTool.name] = wrappedTool.tool;
      return acc;
    }, {} as ToolSet);
  }
}

/**
 * Create a task completion tool that allows the agent to signal when a task is complete
 */
export function createTaskCompletionTool() {
  return wrapTool({
    name: 'taskCompletion',
    description: 'Signal whether the objective has been achieved or not',
    schema: z.object({
      objectiveAchieved: z
        .boolean()
        .describe('Whether the objective has been successfully achieved'),
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
  });
}

const CodeChangeSchema = z.object({
  filePath: z.string().describe('Path to the file that needs changes'),
  description: z.string().describe('Description of what changes are needed'),
  dependencies: z.array(z.string()).optional().describe('Optional list of dependencies needed'),
});

export type CodeChange = z.infer<typeof CodeChangeSchema>;

const RepositoryAnalysisSchema = z.object({
  changes: z.array(CodeChangeSchema).describe('List of changes needed in the repository'),
});

export type RepositoryAnalysis = z.infer<typeof RepositoryAnalysisSchema>;

// Schema for updated source code output
const UpdatedSourceCodeSchema = z.object({
  code: z.string().describe('The full, updated source code content.'),
});

export type UpdatedSourceCode = z.infer<typeof UpdatedSourceCodeSchema>;

/**
 * Create a tool for returning repository analysis results
 */
export function createRepositoryAnalysisTool() {
  return wrapTool({
    name: 'repositoryAnalysis',
    description: 'Return the analysis results for repository changes',
    schema: RepositoryAnalysisSchema,
    execute: async params => {
      return {
        changes: params.changes,
      };
    },
  });
}

/**
 * Create a unified tool for returning updated source code.
 * The prompt/task given to the LLM should specify the reason for the update (e.g., bug fix, linting, test fix).
 */
export function createUpdatedSourceCodeTool() {
  return wrapTool({
    name: 'provideUpdatedCode',
    description:
      'Return the complete, updated source code based on the current task (e.g., fixing bugs, linting, or resolving test issues).',
    schema: UpdatedSourceCodeSchema,
    execute: async params => {
      // The tool's job is just to return the code provided by the LLM.
      return params;
    },
    getReadableParams: params => {
      // Return a snippet or indication that code is being provided.
      return params.code
        ? `(updated code provided: ${params.code.substring(0, 30)}...)`
        : '(updated code provided)';
    },
  });
}
