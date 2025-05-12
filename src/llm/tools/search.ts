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
