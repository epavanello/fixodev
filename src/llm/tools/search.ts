import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import fastGlob from 'fast-glob';
import { createTool } from './types';

const ignoreDirs = ['.git', 'node_modules', 'dist', 'build', 'coverage'];

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
  });

  return createTool({
    name: 'grepCode',
    description: 'Search code with regular expressions',
    schema,
    execute: async params => {
      try {
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
};

/**
 * Create a tool for finding files by name/path pattern
 */
export const createFindFilesTool = (basePath: string) => {
  const schema = z.object({
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
  });

  return createTool({
    name: 'findFiles',
    description:
      'Find files by name pattern. Supports glob patterns, regex, or simple text matching.',
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
};
