import * as z from 'zod';
import { join } from 'path';
import { wrapTool } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';
import fastGlob from 'fast-glob';

export type FileEntry = [string, number];

async function getFormattedFileEntry(
  absoluteFilePath: string,
  basePathForRelative?: string,
): Promise<FileEntry> {
  const name = basePathForRelative
    ? path.relative(basePathForRelative, absoluteFilePath)
    : path.basename(absoluteFilePath);

  let lineCount = 0;
  try {
    const content = await fs.readFile(absoluteFilePath, 'utf-8');
    lineCount = content.split('\n').length;
  } catch (e) {
    console.warn(`Could not read file ${absoluteFilePath} for line count: ${(e as Error).message}`);
    // lineCount remains 0, which is the default
  }
  return [name, lineCount];
}

const defaultIgnoreDirs = ['.git', 'node_modules', 'dist', 'build', 'coverage'];
const defaultIgnoreFiles = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

async function readGitignore(basePath: string): Promise<string[]> {
  try {
    const gitignorePath = path.join(basePath, '.gitignore');
    const content = await fs.readFile(gitignorePath, 'utf-8');

    // Parse the .gitignore file and extract directories
    // Filter out comments, empty lines, and files (entries without trailing slash)
    // Also remove the trailing slash if present
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(
        line =>
          line &&
          !line.startsWith('#') &&
          !line.includes('*') && // Skip patterns with wildcards for simplicity
          !line.startsWith('!'), // Skip negated patterns
      )
      .map(line => (line.endsWith('/') ? line.slice(0, -1) : line));
  } catch (error) {
    // If .gitignore doesn't exist or can't be read, return an empty array
    return [];
  }
}

async function getIgnoreDirs(basePath: string, additionalDirs: string[] = []): Promise<string[]> {
  const gitignoreDirs = await readGitignore(basePath);

  // Merge all directories and remove duplicates
  return [...new Set([...defaultIgnoreDirs, ...gitignoreDirs, ...additionalDirs])];
}

async function getIgnoreFiles(basePath: string, additionalFiles: string[] = []): Promise<string[]> {
  const gitignoreFiles = await readGitignore(basePath);
  return [...new Set([...defaultIgnoreFiles, ...gitignoreFiles, ...additionalFiles])];
}

function assertPathIsWithinBasePath(basePath: string, filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(basePath)) {
    throw new Error('Access denied: Path is outside of base directory');
  }
}

function errorToToolResult(error: unknown): { error: string } {
  if (error instanceof Error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        error: `File not found: ${error.message}`,
      };
    }
    return {
      error: error.message,
    };
  }
  return {
    error: 'Unknown error',
  };
}

export const readFileTool = wrapTool({
  name: 'readFile',
  description: 'Read the contents of a file',
  schema: z.object({
    path: z.string().describe('Path to the file, relative to the repository root'),
    startLine: z
      .number()
      .optional()
      .describe('Line number to start reading from (1-indexed, inclusive)'),
    endLine: z.number().optional().describe('Line number to end reading at (1-indexed, inclusive)'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }
    try {
      const filePath = join(context.basePath, params.path);
      assertPathIsWithinBasePath(context.basePath, filePath);

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
      return errorToToolResult(error);
    }
  },
  getReadableResult: result => {
    if ('error' in result && result.error) {
      return `Error: ${result.error}`;
    }
    if ('content' in result && typeof result.content === 'string') {
      return result.content.slice(0, 50) + '...';
    }
    return 'Unable to display result content.';
  },
});

export const fileExistsTool = wrapTool({
  name: 'fileExists',
  description: 'Check if a file exists',
  schema: z.object({
    path: z.string().describe('Path to the file, relative to the repository root'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const filePath = join(context.basePath, params.path);
      assertPathIsWithinBasePath(context.basePath, filePath);

      try {
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
    } catch (error) {
      return errorToToolResult(error);
    }
  },
});

export const listDirectoryTool = wrapTool({
  name: 'listDirectory',
  description: 'List the contents of a directory. Files are returned as [name, lineCount] tuples.',
  schema: z.object({
    path: z.string().describe('Path to the directory, relative to the repository root'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const dirPath = join(context.basePath, params.path);
      assertPathIsWithinBasePath(context.basePath, dirPath);

      const ignoreDirs = await getIgnoreDirs(context.basePath);
      const ignoreFiles = await getIgnoreFiles(context.basePath);

      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(file => !ignoreFiles.includes(file));
      const directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(dir => !ignoreDirs.includes(dir));

      const fileDetails = await Promise.all(
        files.map(async file => {
          const filePath = join(dirPath, file);
          return getFormattedFileEntry(filePath);
        }),
      );

      return {
        path: params.path,
        files: fileDetails,
        directories,
      };
    } catch (error) {
      return errorToToolResult(error);
    }
  },
});

export const showFileTreeTool = wrapTool({
  name: 'showFileTree',
  description: `Show the file tree of a directory. Output is a compact JSON structure. Directories are represented as ["directoryName", [children...]], and files as ["fileName", lineCount].`,
  schema: z.object({
    path: z.string().describe('Path to the directory, relative to the repository root'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const dirPath = join(context.basePath, params.path);
      assertPathIsWithinBasePath(context.basePath, dirPath);

      const ignoreDirs = await getIgnoreDirs(context.basePath);
      const ignoreFiles = await getIgnoreFiles(context.basePath);

      async function buildCompactTree(currentPath: string, relativePath: string): Promise<any[]> {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        type TreeEntry = [string, TreeEntry[]] | FileEntry;
        const tree: TreeEntry[] = [];

        for (const entry of entries) {
          const entryRelativePath = join(relativePath, entry.name);
          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name)) {
              const fullPath = join(currentPath, entry.name);
              const children = await buildCompactTree(fullPath, entryRelativePath);
              tree.push([entry.name, children]);
            }
          } else {
            if (!ignoreFiles.includes(entry.name)) {
              const filePath = join(currentPath, entry.name);
              tree.push(await getFormattedFileEntry(filePath));
            }
          }
        }
        return tree;
      }

      const tree = await buildCompactTree(dirPath, params.path === '.' ? '' : params.path); // Adjust relative path for root

      return {
        path: params.path,
        tree, // The tree is now in a more compact [name, children_or_line_count] format
      };
    } catch (error) {
      return errorToToolResult(error);
    }
  },
});

export const grepCodeTool = wrapTool({
  name: 'grepCode',
  description:
    'Search code with regular expressions. Each result includes the matching line, its number, and the file information as a [filePath, totalLineCount] tuple.',
  schema: z.object({
    pattern: z.string().min(1).describe('Regular expression pattern to search for'),
    paths: z
      .array(z.string())
      .optional()
      .describe(
        'Paths or globs to search in, relative to the repository root. Each entry can be a directory path (for recursive search) or a direct file path. Directories are searched recursively applying extension filters. Files are searched directly, respecting extension filters.',
      ),
    extensions: z
      .array(z.string())
      .optional()
      .describe('File extensions to include (e.g., ".ts", ".js")'),
    maxResults: z
      .number()
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of results to return (default: 20, max: 100)'),
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
      const ignoreDirs = await getIgnoreDirs(context.basePath);
      const ignoreFiles = await getIgnoreFiles(context.basePath);

      const allResults: Array<{ file: FileEntry; lineNumber: number; content: string }> = [];
      const regex = new RegExp(params.pattern, params.caseSensitive ? '' : 'i');
      const normalizedExtensions = params.extensions?.map(ext =>
        ext.startsWith('.') ? ext : `.${ext}`,
      );

      const processFileContent = async (filePath: string, fileContent: string) => {
        const lines = fileContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (allResults.length >= params.maxResults) break;
          if (regex.test(lines[i])) {
            allResults.push({
              file: await getFormattedFileEntry(filePath),
              lineNumber: i + 1,
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
              ignore: [
                ...(ignoreDirs ?? []).map(d => `**/${d}/**`),
                ...(ignoreFiles ?? []).map(f => `**/${f}`),
              ],
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
          // Check if the file itself is in the ignoreFiles list
          if (ignoreFiles.includes(path.basename(filePath))) {
            continue;
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
      return errorToToolResult(error);
    }
  },
});

export const findFilesTool = wrapTool({
  name: 'findFiles',
  description:
    'Find files by name pattern. Supports glob patterns, regex, or simple text matching. Returns a list of [filePath, lineCount] tuples.',
  schema: z.object({
    pattern: z
      .string()
      .min(1)
      .describe(
        'Pattern to search for in file names. Can be a simple glob pattern, regex, or text pattern',
      ),
    directory: z
      .string()
      .optional()
      .default('.')
      .describe('Directory to search in, relative to the repository root'),
    extensions: z
      .array(z.string())
      .optional()
      .describe('File extensions to include (e.g., ".ts", ".js")'),
    maxResults: z.number().optional().default(20).describe('Maximum number of results to return'),
  }),
  execute: async (params, _, context) => {
    if (!context) {
      throw new Error('Context is required');
    }

    try {
      const basePath = context.basePath;
      const ignoreDirs = await getIgnoreDirs(context.basePath);
      const ignoreFiles = await getIgnoreFiles(context.basePath);

      // Prepare search directory
      const searchDir = path.join(basePath, params.directory);
      assertPathIsWithinBasePath(basePath, searchDir);

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
        ignore: [
          ...(ignoreDirs ?? []).map(d => `**/${d}/**`),
          ...(ignoreFiles ?? []).map(f => `**/${f}`),
        ],
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
      const matchedFilesRelativePaths = allFiles
        .filter(file => patternRegex.test(path.basename(file)))
        .filter(file => !ignoreFiles.includes(path.basename(file)))
        .slice(0, params.maxResults)
        .map(file => path.join(params.directory, file)); // These are relative to basePath

      // Now, get the formatted entries with line counts
      const filesWithLineCounts = await Promise.all(
        matchedFilesRelativePaths.map(async relativeFilePath => {
          const absoluteFilePath = path.join(basePath, relativeFilePath);
          // We want the relative path in the output, so pass basePath as the second argument to the helper.
          return getFormattedFileEntry(absoluteFilePath, basePath);
        }),
      );

      return { files: filesWithLineCounts };
    } catch (error) {
      return errorToToolResult(error);
    }
  },
});
