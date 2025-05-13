import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import fastGlob from 'fast-glob';
import { createTool } from './types';

/**
 * Create a tool for searching code with regular expressions
 */
export const createGrepTool = (basePath: string) => {
  const schema = z.object({
    /**
     * Regular expression pattern to search for
     */
    pattern: z.string().describe('Regular expression pattern to search for'),

    /**
     * Paths or globs to search in, relative to the repository root
     */
    paths: z
      .array(z.string())
      .optional()
      .describe('Paths or globs to search in, relative to the repository root'),

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
  });

  return createTool({
    name: 'grepCode',
    description: 'Search code with regular expressions',
    schema,
    execute: async params => {
      try {
        // Prepare the glob patterns
        const baseSearchDirs = params.paths?.length
          ? params.paths.map(p => path.join(basePath, p))
          : [basePath];

        const allResults: Array<{ filePath: string; lineNumber: number; content: string }> = [];

        // Search in each base directory
        for (const searchDir of baseSearchDirs) {
          // Create glob patterns for extensions
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
          const files = await fastGlob(patterns, {
            onlyFiles: true,
            cwd: searchDir,
          });

          // Create regex for searching file contents
          const regex = new RegExp(params.pattern, params.caseSensitive ? '' : 'i');

          // Process files and search for matches
          for (const file of files) {
            // Check if we've hit the max results
            if (allResults.length >= params.maxResults) {
              break;
            }

            try {
              const filePath = path.join(searchDir, file);
              const content = await fs.readFile(filePath, 'utf-8');
              const lines = content.split('\n');

              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  // Convert to relative path from basePath
                  const relativePath = path.relative(basePath, filePath);

                  allResults.push({
                    filePath: relativePath,
                    lineNumber: i + 1, // 1-indexed line numbers
                    content: lines[i],
                  });

                  // Check if we've hit the max results
                  if (allResults.length >= params.maxResults) {
                    break;
                  }
                }
              }
            } catch (err) {
              // Skip files that can't be read
              continue;
            }
          }

          // Check if we've hit the max results
          if (allResults.length >= params.maxResults) {
            break;
          }
        }

        return { results: allResults };
      } catch (error) {
        return {
          results: [],
          error: `Search failed: ${(error as Error).message}`,
        };
      }
    },
  });
};

/**
 * Create a tool for finding files by name/path pattern
 */
export const createFindFilesTool = (basePath: string) => {
  const schema = z.object({
    /**
     * Pattern to search for in file names
     */
    pattern: z.string().describe('Pattern to search for in file names'),

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
    maxResults: z.number().optional().default(100).describe('Maximum number of results to return'),
  });

  return createTool({
    name: 'findFiles',
    description: 'Find files by name pattern',
    schema,
    execute: async params => {
      try {
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
        });

        // Filter by pattern in filename
        const patternRegex = new RegExp(params.pattern, 'i');
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
};
