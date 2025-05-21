import * as z from 'zod';
import { join } from 'path';
import { wrapTool } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';
import fastGlob from 'fast-glob';

const ignoreDirs = ['.git', 'node_modules', 'dist', 'build', 'coverage'];

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
        return {
          error: `File not found: ${params.path}`,
        };
      }
      return {
        error: `Error reading file: ${(error as Error).message}`,
      };
    }
  },
  getReadableResult: result => {
    if ('error' in result && result.error) {
      return `Error: ${result.error}`;
    } else {
      return result.content?.slice(0, 50) + '...';
    }
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

      const fileDetails = await Promise.all(
        files.map(async file => {
          const filePath = join(dirPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const lineCount = content.split('\n').length;
          return { name: file, lineCount };
        }),
      );

      return {
        path: params.path,
        files: fileDetails,
        directories,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          error: `Directory not found: ${params.path}`,
        };
      }
      return {
        error: `Error listing directory: ${(error as Error).message}`,
      };
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
        return {
          error: `Directory not found: ${params.path}`,
        };
      }
      return {
        error: `Error showing file tree: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * A tool for searching code with regular expressions
 */
export const grepCodeTool = wrapTool({
  name: 'grepCode',
  description: 'Search code with regular expressions',
  schema: z.object({
    /**
     * Regular expression pattern to search for
     */
    pattern: z.string().describe('Regular expression pattern to search for'),

    /**
     * Paths or globs to search in, relative to the repository root. Each entry can be a directory path (for recursive search) or a direct file path. Directories are searched recursively applying extension filters. Files are searched directly, respecting extension filters.
     */
    paths: z
      .array(z.string())
      .optional()
      .describe(
        'Paths or globs to search in, relative to the repository root. Each entry can be a directory path (for recursive search) or a direct file path. Directories are searched recursively applying extension filters. Files are searched directly, respecting extension filters.',
      ),

    /**
     * File extensions to include (e.g., '.ts', '.js')
     */
    extensions: z
      .array(z.string())
      .optional()
      .describe('File extensions to include (e.g., ".ts", ".js")'),

    /**
     * Maximum number of results to return
     */
    maxResults: z.number().optional().default(100).describe('Maximum number of results to return'),

    /**
     * Whether to use case-sensitive matching
     */
    caseSensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to use case-sensitive matching'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const basePath = context.basePath;

      const allResults: Array<{ filePath: string; lineNumber: number; content: string }> = [];
      const regex = new RegExp(params.pattern, params.caseSensitive ? '' : 'i');
      const normalizedExtensions = params.extensions?.map(ext =>
        ext.startsWith('.') ? ext : `.${ext}`,
      );

      const processFileContent = async (filePath: string, fileContent: string) => {
        const lines = fileContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (allResults.length >= params.maxResults) break;
          if (regex.test(lines[i])) {
            const relativePath = path.relative(basePath, filePath);
            allResults.push({
              filePath: relativePath,
              lineNumber: i + 1, // 1-indexed line numbers
              content: lines[i],
            });
          }
        }
      };

      const baseEntries = params.paths?.length
        ? params.paths.map(p => path.join(basePath, p))
        : [basePath]; // If no paths, consider basePath as the single entry to process

      for (const entryPath of baseEntries) {
        if (allResults.length >= params.maxResults) break;

        let stats;
        try {
          stats = await fs.stat(entryPath);
        } catch (e) {
          // console.warn(`Skipping path ${entryPath} due to stat error: ${(e as Error).message}`);
          continue; // Path doesn't exist or other stat error
        }

        if (stats.isDirectory()) {
          const searchDir = entryPath;
          const globPatterns: string[] = [];

          if (normalizedExtensions?.length) {
            for (const ext of normalizedExtensions) {
              globPatterns.push(`**/*${ext}`);
            }
          } else {
            globPatterns.push('**/*');
          }

          try {
            const filesInDir = await fastGlob(globPatterns, {
              onlyFiles: true,
              cwd: searchDir,
              ignore: ignoreDirs?.map(d => `**/${d}/**`),
              dot: true, // Include hidden files if not in ignoreDirs
            });

            for (const fileRelativeName of filesInDir) {
              if (allResults.length >= params.maxResults) break;
              const absoluteFilePath = path.join(searchDir, fileRelativeName);
              try {
                const content = await fs.readFile(absoluteFilePath, 'utf-8');
                await processFileContent(absoluteFilePath, content);
              } catch (err) {
                // console.warn(`Skipping file ${absoluteFilePath} in directory scan due to read error: ${(err as Error).message}`);
                // Skip files that can't be read
                continue;
              }
            }
          } catch (globError) {
            // console.warn(`Error globbing in directory ${searchDir}: ${(globError as Error).message}`);
            continue;
          }
        } else if (stats.isFile()) {
          const filePath = entryPath;
          if (normalizedExtensions?.length) {
            const fileExt = path.extname(filePath);
            if (!normalizedExtensions.includes(fileExt)) {
              continue; // Skip if extension doesn't match
            }
          }

          if (allResults.length >= params.maxResults) break; // Check before reading the file

          try {
            const content = await fs.readFile(filePath, 'utf-8');
            await processFileContent(filePath, content);
          } catch (err) {
            // console.warn(`Skipping file ${filePath} due to read error: ${(err as Error).message}`);
            // Skip files that can't be read
            continue;
          }
        }
        // No need for an explicit break here for maxResults, as inner loops and checks handle it.
      }
      return { results: allResults.slice(0, params.maxResults) }; // Ensure results are capped
    } catch (error) {
      return {
        results: [],
        error: `Search failed: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * A tool for finding files by name/path pattern
 */
export const findFilesTool = wrapTool({
  name: 'findFiles',
  description:
    'Find files by name pattern. Supports glob patterns, regex, or simple text matching.',
  schema: z.object({
    /**
     * Pattern to search for in file names. Can be:
     * - A simple glob pattern (e.g., "*.ts", "test*")
     * - A regular expression (e.g., "test.*\\.ts$")
     * - A simple text pattern (e.g., "test")
     */
    pattern: z
      .string()
      .describe(
        'Pattern to search for in file names. Can be a simple glob pattern, regex, or text pattern',
      ),

    /**
     * Directory to search in, relative to the repository root
     */
    directory: z
      .string()
      .optional()
      .default('.')
      .describe('Directory to search in, relative to the repository root'),

    /**
     * File extensions to include (e.g., '.ts', '.js')
     */
    extensions: z
      .array(z.string())
      .optional()
      .describe('File extensions to include (e.g., ".ts", ".js")'),

    /**
     * Maximum number of results to return
     */
    maxResults: z.number().optional().default(20).describe('Maximum number of results to return'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const basePath = context.basePath;

      // Prepare search directory
      const searchDir = path.join(basePath, params.directory);

      // Create glob patterns based on extensions
      const patterns: string[] = [];

      if (params.extensions?.length) {
        for (const ext of params.extensions) {
          const extension = ext.startsWith('.') ? ext : `.${ext}`;
          patterns.push(`**/*${extension}`);
        }
      } else {
        patterns.push(`**/*`);
      }

      // Find all matching files
      const allFiles = await fastGlob(patterns, {
        onlyFiles: true,
        cwd: searchDir,
        ignore: ignoreDirs?.map(d => `**/${d}/**`),
      });

      // Convert glob pattern to regex if needed
      let patternRegex: RegExp;
      try {
        // First try to use it as a regex
        patternRegex = new RegExp(params.pattern, 'i');
      } catch {
        // If it fails, convert glob pattern to regex
        const globPattern = params.pattern
          .replace(/\./g, '\\.') // Escape dots
          .replace(/\*/g, '.*') // Convert * to .*
          .replace(/\?/g, '.'); // Convert ? to .
        patternRegex = new RegExp(`^${globPattern}$`, 'i');
      }

      // Filter by pattern in filename
      const files = allFiles
        .filter(file => patternRegex.test(path.basename(file)))
        .slice(0, params.maxResults)
        .map(file => path.join(params.directory, file));

      return { files };
    } catch (error) {
      return {
        files: [],
        error: `Find failed: ${(error as Error).message}`,
      };
    }
  },
});
