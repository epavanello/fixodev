import * as z from 'zod';
import * as util from 'util';
import * as child_process from 'child_process';
import { createTool } from './types';

const exec = util.promisify(child_process.exec);

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
        let command = `cd "${basePath}" && grep -n`;

        if (!params.caseSensitive) {
          command += ' -i';
        }

        command += ' -r';

        // Add pattern
        command += ` "${params.pattern.replace(/"/g, '\\"')}"`;

        // Add paths
        if (params.paths && params.paths.length > 0) {
          command += ' ' + params.paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
        } else {
          command += ' .';
        }

        // Add extensions if specified
        if (params.extensions && params.extensions.length > 0) {
          const extensionPattern = params.extensions
            .map(ext => (ext.startsWith('.') ? `\\${ext}` : `\\.${ext}`))
            .join('|');
          command += ` | grep -E "(${extensionPattern})$"`;
        }

        // Limit results
        command += ` | head -n ${params.maxResults}`;

        const { stdout, stderr } = await exec(command);

        if (stderr && !stdout) {
          return { results: [] };
        }

        // Parse the results
        const results = stdout
          .trim()
          .split('\n')
          .filter(line => line.trim() !== '')
          .map(line => {
            // Format is typically: filename:lineNumber:matchedLine
            const firstColonIdx = line.indexOf(':');
            if (firstColonIdx === -1) return null;

            const filePath = line.substring(0, firstColonIdx);
            const rest = line.substring(firstColonIdx + 1);

            const secondColonIdx = rest.indexOf(':');
            if (secondColonIdx === -1) return null;

            const lineNumber = parseInt(rest.substring(0, secondColonIdx), 10);
            const content = rest.substring(secondColonIdx + 1);

            return {
              filePath,
              lineNumber,
              content,
            };
          })
          .filter(Boolean);

        return { results };
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
        let command = `cd "${basePath}" && find "${params.directory}" -type f`;

        if (params.extensions && params.extensions.length > 0) {
          const extensionPatterns = params.extensions
            .map(ext => {
              const extension = ext.startsWith('.') ? ext : `.${ext}`;
              return `-name "*${extension}"`;
            })
            .join(' -o ');

          command += ` \\( ${extensionPatterns} \\)`;
        }

        command += ` | grep -i "${params.pattern.replace(/"/g, '\\"')}"`;
        command += ` | head -n ${params.maxResults}`;

        const { stdout, stderr } = await exec(command);

        if (stderr && !stdout) {
          return { files: [] };
        }

        const files = stdout
          .trim()
          .split('\n')
          .filter(line => line.trim() !== '');

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

/**
 * Create a tool for finding symbols in code (functions, classes, etc.)
 */
export const createFindSymbolsTool = (basePath: string) => {
  const schema = z.object({
    /**
     * Symbol pattern to search for (function name, class name, etc.)
     */
    pattern: z.string().describe('Symbol pattern to search for (function name, class name, etc.)'),

    /**
     * Type of symbol to search for
     */
    symbolType: z
      .enum(['function', 'class', 'variable', 'any'])
      .default('any')
      .describe('Type of symbol to search for'),

    /**
     * Paths or globs to search in, relative to the repository root
     */
    paths: z
      .array(z.string())
      .optional()
      .describe('Paths or globs to search in, relative to the repository root'),

    /**
     * Maximum number of results to return
     */
    maxResults: z.number().optional().default(20).describe('Maximum number of results to return'),
  });

  return createTool({
    name: 'findSymbols',
    description: 'Find code symbols (functions, classes, etc.)',
    schema,
    execute: async params => {
      try {
        // Build patterns based on symbolType
        let grepPatterns: string[] = [];

        switch (params.symbolType) {
          case 'function':
            grepPatterns = [
              `function\\s+${params.pattern}\\s*\\(`, // function declaration
              `const\\s+${params.pattern}\\s*=\\s*function\\s*\\(`, // function expression
              `const\\s+${params.pattern}\\s*=\\s*\\(.*\\)\\s*=>`, // arrow function
              `${params.pattern}\\s*\\(.*\\)\\s*{`, // method definition
            ];
            break;
          case 'class':
            grepPatterns = [
              `class\\s+${params.pattern}\\s*{`,
              `class\\s+${params.pattern}\\s+extends\\s+`,
              `class\\s+${params.pattern}\\s+implements\\s+`,
            ];
            break;
          case 'variable':
            grepPatterns = [
              `const\\s+${params.pattern}\\s*=`,
              `let\\s+${params.pattern}\\s*=`,
              `var\\s+${params.pattern}\\s*=`,
            ];
            break;
          case 'any':
          default:
            // All of the above patterns
            grepPatterns = [
              `function\\s+${params.pattern}\\s*\\(`,
              `const\\s+${params.pattern}\\s*=\\s*function\\s*\\(`,
              `const\\s+${params.pattern}\\s*=\\s*\\(.*\\)\\s*=>`,
              `class\\s+${params.pattern}\\s*{`,
              `class\\s+${params.pattern}\\s+extends\\s+`,
              `class\\s+${params.pattern}\\s+implements\\s+`,
              `const\\s+${params.pattern}\\s*=`,
              `let\\s+${params.pattern}\\s*=`,
              `var\\s+${params.pattern}\\s*=`,
              `${params.pattern}\\s*\\(.*\\)\\s*{`,
            ];
            break;
        }

        // Escape special regex characters in pattern
        const combinedPattern = grepPatterns.join('|');

        let command = `cd "${basePath}" && grep -n -E '${combinedPattern}' -r`;

        // Add paths
        if (params.paths && params.paths.length > 0) {
          command += ' ' + params.paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
        } else {
          command += ' .';
        }

        // Limit results
        command += ` | head -n ${params.maxResults}`;

        const { stdout, stderr } = await exec(command);

        if (stderr && !stdout) {
          return { symbols: [] };
        }

        // Parse the results
        const symbols = stdout
          .trim()
          .split('\n')
          .filter(line => line.trim() !== '')
          .map(line => {
            // Format is typically: filename:lineNumber:matchedLine
            const firstColonIdx = line.indexOf(':');
            if (firstColonIdx === -1) return null;

            const filePath = line.substring(0, firstColonIdx);
            const rest = line.substring(firstColonIdx + 1);

            const secondColonIdx = rest.indexOf(':');
            if (secondColonIdx === -1) return null;

            const lineNumber = parseInt(rest.substring(0, secondColonIdx), 10);
            const content = rest.substring(secondColonIdx + 1);

            let symbolType: string;
            if (content.includes('class')) {
              symbolType = 'class';
            } else if (
              content.includes('function') ||
              content.includes('=>') ||
              content.match(/\w+\s*\(.*\)\s*{/)
            ) {
              symbolType = 'function';
            } else if (
              content.includes('const') ||
              content.includes('let') ||
              content.includes('var')
            ) {
              symbolType = 'variable';
            } else {
              symbolType = 'unknown';
            }

            return {
              filePath,
              lineNumber,
              content: content.trim(),
              symbolType,
            };
          })
          .filter(Boolean);

        return { symbols };
      } catch (error) {
        return {
          symbols: [],
          error: `Symbol search failed: ${(error as Error).message}`,
        };
      }
    },
  });
};
