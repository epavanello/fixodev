import * as z from 'zod';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { wrapTool } from './types';

/**
 * A tool for writing to a file
 */
export const writeFileTool = wrapTool({
  name: 'writeFile',
  description: 'Write content to a file',
  schema: z.object({
    /**
     * Path to the file, relative to the base path
     */
    path: z.string().describe('Path to the file, relative to the repository root'),

    /**
     * Content to write to the file
     */
    content: z.string().describe('Content to write to the file'),

    /**
     * Whether to create the directory if it doesn't exist
     */
    createDirectories: z
      .boolean()
      .default(true)
      .describe("Whether to create parent directories if they don't exist"),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const filePath = join(context.basePath, params.path);

      if (params.createDirectories) {
        await fs.mkdir(dirname(filePath), { recursive: true });
      }

      await fs.writeFile(filePath, params.content, 'utf-8');

      return {
        success: true,
        path: params.path,
      };
    } catch (error) {
      return {
        error: `Error writing file: ${(error as Error).message}`,
      };
    }
  },
});
