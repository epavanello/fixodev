import * as z from 'zod';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { wrapTool } from './types';

/**
 * A tool for reading file contents
 */
export const readFileTool = wrapTool({
  name: 'readFile',
  description: 'Read the contents of a file',
  schema: z.object({
    /**
     * Path to the file, relative to the base path
     */
    path: z.string().describe('Path to the file, relative to the repository root'),

    /**
     * Line number to start reading from (1-indexed, inclusive)
     */
    startLine: z
      .number()
      .optional()
      .describe('Line number to start reading from (1-indexed, inclusive)'),

    /**
     * Line number to end reading at (1-indexed, inclusive)
     */
    endLine: z.number().optional().describe('Line number to end reading at (1-indexed, inclusive)'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const filePath = join(context.basePath, params.path);
      const content = await fs.readFile(filePath, 'utf-8');

      if (params.startLine || params.endLine) {
        const lines = content.split('\n');
        const start = params.startLine ? Math.max(0, params.startLine - 1) : 0;
        const end = params.endLine ? Math.min(lines.length, params.endLine) : lines.length;

        return {
          content: lines.slice(start, end).join('\n'),
          startLine: start + 1,
          endLine: end,
          totalLines: lines.length,
        };
      }

      return {
        content,
        totalLines: content.split('\n').length,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${params.path}`);
      }
      throw error;
    }
  },
  getReadableResult: result => {
    return result.content.slice(0, 50) + '...';
  },
});

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
      throw new Error(`Failed to write file: ${(error as Error).message}`);
    }
  },
  getReadableParams: ({ content, ...params }) => {
    return JSON.stringify(
      {
        ...params,
        content: content.slice(0, 50) + '...',
      },
      null,
      2,
    );
  },
});

/**
 * A tool for checking if a file exists
 */
export const fileExistsTool = wrapTool({
  name: 'fileExists',
  description: 'Check if a file exists',
  schema: z.object({
    /**
     * Path to the file, relative to the base path
     */
    path: z.string().describe('Path to the file, relative to the repository root'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const filePath = join(context.basePath, params.path);
      await fs.access(filePath);

      const stats = await fs.stat(filePath);

      return {
        exists: true,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch (error) {
      return {
        exists: false,
        isDirectory: false,
        isFile: false,
      };
    }
  },
});

/**
 * A tool for listing directory contents
 */
export const listDirectoryTool = wrapTool({
  name: 'listDirectory',
  description: 'List the contents of a directory',
  schema: z.object({
    /**
     * Path to the directory, relative to the base path
     */
    path: z.string().describe('Path to the directory, relative to the repository root'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const dirPath = join(context.basePath, params.path);

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);

      const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

      return {
        path: params.path,
        files,
        directories,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Directory not found: ${params.path}`);
      }
      throw error;
    }
  },
});

/**
 * A tool for showing the file tree
 */
export const showFileTreeTool = wrapTool({
  name: 'showFileTree',
  description: 'Show the file tree of a directory',
  schema: z.object({
    /**
     * Path to the directory, relative to the base path
     */
    path: z.string().describe('Path to the directory, relative to the repository root'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const dirPath = join(context.basePath, params.path);
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const tree = entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));

      return {
        path: params.path,
        tree,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Directory not found: ${params.path}`);
      }
      throw error;
    }
  },
});
