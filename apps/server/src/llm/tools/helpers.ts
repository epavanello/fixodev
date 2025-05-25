import path from 'path';
import fs from 'fs/promises';

export type FileEntry = [string, number];

export async function getFormattedFileEntry(
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

export async function getIgnoreDirs(
  basePath: string,
  additionalDirs: string[] = [],
): Promise<string[]> {
  const gitignoreDirs = await readGitignore(basePath);

  // Merge all directories and remove duplicates
  return [...new Set([...defaultIgnoreDirs, ...gitignoreDirs, ...additionalDirs])];
}

export async function getIgnoreFiles(
  basePath: string,
  additionalFiles: string[] = [],
): Promise<string[]> {
  const gitignoreFiles = await readGitignore(basePath);
  return [...new Set([...defaultIgnoreFiles, ...gitignoreFiles, ...additionalFiles])];
}

export function assertPathIsWithinBasePath(basePath: string, filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(basePath)) {
    throw new Error('Access denied: Path is outside of base directory');
  }
}

export function errorToToolResult(error: unknown): { error: string } {
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
