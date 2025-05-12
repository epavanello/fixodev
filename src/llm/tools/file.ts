import * as z from 'zod';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createTool } from './types';

/**
 * Create a tool for reading file contents
 */
export const createReadFileTool = (basePath: string) => {
  const schema = z.object({
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
  });

  return createTool({
    name: 'readFile',
    description: 'Read the contents of a file',
    schema,
    execute: async params => {
      try {
        const filePath = join(basePath, params.path);
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
  });
};

/**
 * Create a tool for writing to a file
 */
export const createWriteFileTool = (basePath: string) => {
  const schema = z.object({
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
  });

  return createTool({
    name: 'writeFile',
    description: 'Write content to a file',
    schema,
    execute: async params => {
      try {
        const filePath = join(basePath, params.path);

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
  });
};

/**
 * Create a tool for checking if a file exists
 */
export const createFileExistsTool = (basePath: string) => {
  const schema = z.object({
    /**
     * Path to the file, relative to the base path
     */
    path: z.string().describe('Path to the file, relative to the repository root'),
  });

  return createTool({
    name: 'fileExists',
    description: 'Check if a file exists',
    schema,
    execute: async params => {
      try {
        const filePath = join(basePath, params.path);
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
};

/**
 * Create a tool for listing directory contents
 */
export const createListDirectoryTool = (basePath: string) => {
  const schema = z.object({
    /**
     * Path to the directory, relative to the base path
     */
    path: z.string().describe('Path to the directory, relative to the repository root'),
  });

  return createTool({
    name: 'listDirectory',
    description: 'List the contents of a directory',
    schema,
    execute: async params => {
      try {
        const dirPath = join(basePath, params.path);
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
};
