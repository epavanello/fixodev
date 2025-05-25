import * as fs from 'fs/promises';
import { watch } from 'fs'; // Bun's built-in watcher
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as Handlebars from 'handlebars';
import { type AST } from '@handlebars/parser';
import fg from 'fast-glob'; // For recursive file search

// --- Type Guards ---
// function isNode(node: any): node is AST.Node { // Unused, removing
//   return node && typeof node.type === 'string' && node.loc;
// }

function isProgram(node: AST.Node): node is AST.Program {
  return node.type === 'Program';
}

function isMustacheStatement(node: AST.Node): node is AST.MustacheStatement {
  return node.type === 'MustacheStatement';
}

function isBlockStatement(node: AST.Node): node is AST.BlockStatement {
  return node.type === 'BlockStatement';
}

function isSubExpression(node: AST.Node): node is AST.SubExpression {
  return node.type === 'SubExpression';
}

function isPathExpression(node: AST.Node): node is AST.PathExpression {
  return node.type === 'PathExpression';
}

function isHash(node: AST.Node): node is AST.Hash {
  return node.type === 'Hash';
}

// function isContentStatement(node: AST.Node): node is AST.ContentStatement {
//   return node.type === 'ContentStatement';
// }

// function isCommentStatement(node: AST.Node): node is AST.CommentStatement {
//   return node.type === 'CommentStatement';
// }

// function isPartialStatement(node: AST.Node): node is AST.PartialStatement {
//   return node.type === 'PartialStatement';
// }

// function isPartialBlockStatement(node: AST.Node): node is AST.PartialBlockStatement {
//   return node.type === 'PartialBlockStatement';
// }

const KNOWN_HANDLEBARS_HELPERS = new Set([
  'if',
  'else',
  'unless',
  'each',
  'with',
  'lookup',
  'log',
  'partial',
  'blockHelperMissing',
  'helperMissing',
  // Consider adding other common non-data helper names if necessary
]);

// Helper to resolve Handlebars path expressions considering context and depth
function resolveHbsPath(baseContextPath: string, pathExpression: AST.PathExpression): string {
  if (pathExpression.data) {
    // For @data variables, the context path and depth are not typically applied in the same way.
    // They refer to frame data.
    return `@${pathExpression.parts.join('.')}`;
  }

  const effectiveBasePathParts = baseContextPath.split('.').filter(Boolean);
  let depth = pathExpression.depth;
  const newBasePathParts = [...effectiveBasePathParts]; // Create a mutable copy

  // Adjust base path based on depth (e.g., ../)
  while (depth > 0 && newBasePathParts.length > 0) {
    newBasePathParts.pop();
    depth--;
  }

  // Combine the adjusted base path with the current expression\'s parts
  const finalParts = [...newBasePathParts, ...pathExpression.parts];
  return finalParts.join('.');
}

function traverse(
  node: AST.Node | undefined | null,
  foundPlaceholders: Set<string>,
  arrayPlaceholders: Set<string>,
  booleanPlaceholders: Set<string>,
  currentDataContextPath: string,
): void {
  if (!node) return;

  let pathNodeForBlockHelperData: AST.PathExpression | undefined = undefined;
  let isBlockHelperOriginator = false;
  let blockHelperName: string | undefined = undefined;

  if (isBlockStatement(node)) {
    isBlockHelperOriginator = true;
    blockHelperName = node.path.original; // e.g., 'each', 'if', 'with'
    // The first param of these block helpers is usually the data path
    if (node.params.length > 0 && isPathExpression(node.params[0])) {
      pathNodeForBlockHelperData = node.params[0] as AST.PathExpression;
    } else if (blockHelperName === 'if' || blockHelperName === 'unless') {
      // Sometimes {{#if someFlag}} where someFlag is directly the path.
      // In this case node.path is someFlag, and node.params is empty.
      pathNodeForBlockHelperData = node.path;
    }
  } else if (isMustacheStatement(node) || isSubExpression(node)) {
    // Handle simple mustaches and sub-expressions for their paths
    if (isPathExpression(node.path)) {
      const resolvedPath = resolveHbsPath(currentDataContextPath, node.path);
      if (!KNOWN_HANDLEBARS_HELPERS.has(node.path.original) && !node.path.data) {
        foundPlaceholders.add(resolvedPath);
      }
    } else if (isSubExpression(node.path)) {
      traverse(
        node.path,
        foundPlaceholders,
        arrayPlaceholders,
        booleanPlaceholders,
        currentDataContextPath,
      );
    }
  }

  if (isBlockHelperOriginator && blockHelperName && pathNodeForBlockHelperData) {
    const dataPathForBlock = resolveHbsPath(currentDataContextPath, pathNodeForBlockHelperData);
    let newContextForProgram = currentDataContextPath;

    // Add the data path itself to placeholders, as it's being used.
    // Avoid adding if it resolves to empty or just 'this'/'.' in root context.
    if (dataPathForBlock && dataPathForBlock !== 'this' && dataPathForBlock !== '.') {
      foundPlaceholders.add(dataPathForBlock);
    }

    if (blockHelperName === 'each') {
      arrayPlaceholders.add(dataPathForBlock);
      newContextForProgram = dataPathForBlock;
    } else if (blockHelperName === 'if' || blockHelperName === 'unless') {
      booleanPlaceholders.add(dataPathForBlock);
      // Context for program/inverse of if/unless remains currentDataContextPath
    } else if (blockHelperName === 'with') {
      newContextForProgram = dataPathForBlock;
    }

    const blockNode = node as AST.BlockStatement; // Already checked by isBlockStatement path
    if (blockNode.program) {
      traverse(
        blockNode.program,
        foundPlaceholders,
        arrayPlaceholders,
        booleanPlaceholders,
        newContextForProgram,
      );
    }
    if (blockNode.inverse) {
      const contextForInverse =
        blockHelperName === 'with' ? currentDataContextPath : newContextForProgram;
      traverse(
        blockNode.inverse,
        foundPlaceholders,
        arrayPlaceholders,
        booleanPlaceholders,
        contextForInverse,
      );
    }
    // After processing a block, its params and hash are processed below if it was also a Mustache-like structure (not typical for pure blocks)
    // but the main block traversal logic is complete.
  } else if (
    isBlockStatement(node) &&
    !pathNodeForBlockHelperData &&
    (node.path.original === 'if' || node.path.original === 'unless')
  ) {
    // Special case for {{#if someDirectPath}} where `someDirectPath` is node.path and params is empty
    const dataPathForBlock = resolveHbsPath(currentDataContextPath, node.path);
    booleanPlaceholders.add(dataPathForBlock);
    if (dataPathForBlock && dataPathForBlock !== 'this' && dataPathForBlock !== '.') {
      foundPlaceholders.add(dataPathForBlock);
    }
    if (node.program) {
      traverse(
        node.program,
        foundPlaceholders,
        arrayPlaceholders,
        booleanPlaceholders,
        currentDataContextPath,
      );
    }
    if (node.inverse) {
      traverse(
        node.inverse,
        foundPlaceholders,
        arrayPlaceholders,
        booleanPlaceholders,
        currentDataContextPath,
      );
    }
  }

  // Process params and hash for MustacheStatements, SubExpressions, and potentially BlockStatements
  // (though hash/params on BlockStatements are less common for data access than their main data path)
  if (isMustacheStatement(node) || isSubExpression(node) || isBlockStatement(node)) {
    if (node.params) {
      node.params.forEach((param: AST.Expression) => {
        // If a block already handled its main data path via pathNodeForBlockHelperData,
        // don't re-add it if it appears in params (e.g. {{#each items as |item|}} items is main, item is block param)
        // For simple mustaches, any path param is a placeholder.
        if (param !== pathNodeForBlockHelperData) {
          // Avoid reprocessing the main data path of a block if it's also in params
          if (isPathExpression(param)) {
            const paramPath = resolveHbsPath(currentDataContextPath, param);
            if (!KNOWN_HANDLEBARS_HELPERS.has(param.original) && !param.data) {
              foundPlaceholders.add(paramPath);
            }
          } else if (isSubExpression(param)) {
            traverse(
              param,
              foundPlaceholders,
              arrayPlaceholders,
              booleanPlaceholders,
              currentDataContextPath,
            );
          }
        }
      });
    }
    if (node.hash && isHash(node.hash)) {
      node.hash.pairs.forEach((pair: AST.HashPair) => {
        const valueNode = pair.value;
        if (isPathExpression(valueNode)) {
          const hashValuePath = resolveHbsPath(currentDataContextPath, valueNode);
          if (!KNOWN_HANDLEBARS_HELPERS.has(valueNode.original) && !valueNode.data) {
            foundPlaceholders.add(hashValuePath);
          }
        } else if (isSubExpression(valueNode)) {
          traverse(
            valueNode,
            foundPlaceholders,
            arrayPlaceholders,
            booleanPlaceholders,
            currentDataContextPath,
          );
        }
      });
    }
  }

  // If the node is a Program, traverse its body (handles root AST and other generic statement lists)
  // This has to be careful not to re-traverse bodies of blocks already handled.
  // The return statements within block processing in the original logic helped manage this.
  // If isBlockHelperOriginator is true, its program/inverse were handled, so don't re-traverse its body here.
  if (isProgram(node) && !isBlockHelperOriginator) {
    // Check !isBlockHelperOriginator might be too broad
    // Better: check if current node is a BlockStatement whose program was just handled.
    // For now, let the block logic handle its own program/inverse exclusively.
    node.body.forEach((child: AST.Statement) => {
      // If the child is a BlockStatement, its specific handler would have been called first.
      // If it returns, this loop won't process its program again. This is subtle.
      traverse(
        child,
        foundPlaceholders,
        arrayPlaceholders,
        booleanPlaceholders,
        currentDataContextPath,
      );
    });
  }
}

/**
 * Extracts unique placeholder paths from a Handlebars template string.
 */
const extractPlaceholders = (
  templateContent: string,
): {
  placeholders: string[];
  arrayPaths: Set<string>;
  booleanPaths: Set<string>;
} => {
  try {
    const ast = Handlebars.parse(templateContent);
    const foundPlaceholders = new Set<string>();
    const arrayPlaceholders = new Set<string>();
    const booleanPlaceholders = new Set<string>();

    traverse(ast as AST.Program, foundPlaceholders, arrayPlaceholders, booleanPlaceholders, '');

    // Filter out helper names that might have been added if they were block paths
    const filteredPlaceholders = Array.from(foundPlaceholders).filter(
      p => p !== 'this' && p !== '.',
    );
    // .filter(p => !KNOWN_HANDLEBARS_HELPERS.has(p.split('.').pop() || p)); // Be careful with this, might remove valid data named like helpers

    return {
      placeholders: filteredPlaceholders,
      arrayPaths: arrayPlaceholders,
      booleanPaths: booleanPlaceholders,
    };
  } catch (error) {
    console.error('Error parsing Handlebars template:', error);
    return { placeholders: [], arrayPaths: new Set(), booleanPaths: new Set() };
  }
};

/**
 * Builds a nested object structure from a flat list of placeholder paths.
 */
function buildNestedTypeObject(
  placeholders: string[],
  arrayPaths: Set<string>,
  booleanPaths: Set<string>,
): Record<string, any> {
  const root: Record<string, any> = {};
  if (!placeholders || placeholders.length === 0) return root;

  const sortedPlaceholders = [...placeholders].sort();
  const placeholderSet = new Set(placeholders); // For quick lookups

  for (const placeholder of sortedPlaceholders) {
    const parts = placeholder.split('.');
    let currentObject: Record<string, any> = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? currentPath + '.' + part : part;

      if (i === parts.length - 1) {
        // Leaf of this specific placeholder path
        if (
          typeof currentObject[part] === 'object' &&
          Object.keys(currentObject[part]).length > 0
        ) {
          continue;
        }

        if (arrayPaths.has(currentPath)) {
          currentObject[part] = {};
        } else if (booleanPaths.has(currentPath)) {
          // If it's a boolean path, but also a standalone placeholder (meaning it's rendered),
          // it should be string type by default in the object, but the booleanPaths set will make it optional.
          // If it's ONLY a boolean path and not otherwise a placeholder, then it's a primitive boolean flag.
          if (placeholderSet.has(currentPath)) {
            currentObject[part] = 'string'; // Will become optional string via booleanPaths
          } else {
            currentObject[part] = 'boolean'; // Primitive boolean flag
          }
        } else {
          currentObject[part] = 'string';
        }
      } else {
        if (!currentObject[part] || typeof currentObject[part] !== 'object') {
          currentObject[part] = {};
        }
        currentObject = currentObject[part] as Record<string, any>;
      }
    }
  }
  return root;
}

function buildTypeScriptTypeStringRecursive(
  obj: Record<string, any>,
  indentLevel: number,
  arrayPaths: Set<string>,
  booleanPaths: Set<string>,
  pathPrefix: string = '',
): string {
  let tsString = '';
  const indent = '  '.repeat(indentLevel);
  const keys = Object.keys(obj);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = obj[key];
    const currentPath = pathPrefix ? pathPrefix + '.' + key : key;

    // Property becomes optional if its path was used as a boolean condition.
    tsString += `${indent}readonly ${key}${booleanPaths.has(currentPath) ? '?' : ''}: `;

    if (arrayPaths.has(currentPath)) {
      if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
        tsString += `Array<{\n`;
        tsString += buildTypeScriptTypeStringRecursive(
          value,
          indentLevel + 1,
          arrayPaths,
          booleanPaths,
          currentPath,
        );
        tsString += `${indent}  }>;\n`;
      } else {
        tsString += `Array<string>; // Default for empty array or primitive array\n`;
      }
    } else if (typeof value === 'object' && value !== null) {
      tsString += `{\n`;
      tsString += buildTypeScriptTypeStringRecursive(
        value,
        indentLevel + 1,
        arrayPaths,
        booleanPaths,
        currentPath,
      );
      tsString += `${indent}};\n`;
    } else {
      tsString += `${value};\n`;
    }
  }
  return tsString;
}

/**
 * Converts a nested type object into a TypeScript type definition string.
 */
function typeObjectToTypeScriptString(
  typeObj: Record<string, any>,
  argsTypeName: string,
  arrayPaths: Set<string>,
  booleanPaths: Set<string>,
): string {
  let typeStr = `export type ${argsTypeName} = {\n`;
  const keys = Object.keys(typeObj);

  if (keys.length === 0) {
    typeStr += '  // No placeholders, this an empty object type allows any Record<string, never>\n';
    typeStr +=
      '  readonly [key: string]: any; // Or Record<string, never> if truly no properties\n';
  } else {
    typeStr += buildTypeScriptTypeStringRecursive(typeObj, 1, arrayPaths, booleanPaths);
  }
  typeStr += '};\n';
  return typeStr;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_DIR = path.resolve(__dirname, '../prompts');
const OUTPUT_PROMPTS_FILE = path.resolve(
  path.resolve(__dirname, '../src/llm/prompts'),
  'prompts.ts',
);

/**
 * Converts a kebab-case or snake_case filename to a PascalCase string.
 */
function filenameToPascalCase(filename: string): string {
  return filename
    .replace(/\.(md|txt|hbs|handlebars)$/i, '') // Include .hbs and .handlebars
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

async function generateFunctionsForSinglePromptFile(
  templateFilePath: string,
): Promise<{ typeDef: string; functionDef: string } | null> {
  try {
    const templateFilename = path.basename(templateFilePath);
    const templateContent = await fs.readFile(templateFilePath, 'utf-8');

    const { placeholders, arrayPaths, booleanPaths } = extractPlaceholders(templateContent);
    const nestedTypeObject = buildNestedTypeObject(placeholders, arrayPaths, booleanPaths);

    const baseName = filenameToPascalCase(templateFilename);
    const functionName = `generate${baseName}Prompt`;
    const argsTypeName = `${baseName}Args`;

    const typeDef = typeObjectToTypeScriptString(
      nestedTypeObject,
      argsTypeName,
      arrayPaths,
      booleanPaths,
    );

    const relativeTemplatePath = path.relative(PROMPTS_DIR, templateFilePath).replace(/\\/g, '/');

    let functionDef = `
/**
 * Generates the '${templateFilename}' prompt using Handlebars.
 * Template sub-path relative to prompts directory: ${relativeTemplatePath}
 */
`;
    functionDef += `export async function ${functionName}(
  args: ${argsTypeName}
): Promise<string> {
`;
    // Use process.cwd() to ensure correct path resolution in Docker and dev
    // process.cwd() will be /app in the Docker container, and prompts are in /app/prompts.
    functionDef += `  const templatePath = path.resolve(process.cwd(), 'prompts', '${relativeTemplatePath}');
`;
    functionDef += `  const templateContent = await fs.readFile(templatePath, 'utf-8');
`;
    functionDef += `  const compiledTemplate = Handlebars.compile(templateContent);
`;
    functionDef += `  return compiledTemplate(args);
`;
    functionDef += '}\n';

    return { typeDef, functionDef };
  } catch (error) {
    console.error(`Error processing ${templateFilePath}:`, error);
    return null;
  }
}

async function regenerateAllPromptsFile(): Promise<void> {
  console.log('Scanning for prompt templates in:', PROMPTS_DIR);
  try {
    const templateFilesPaths = await fg(
      path.join(PROMPTS_DIR, '**/*.{md,hbs,handlebars}').replace(/\\/g, '/'),
      {
        ignore: [OUTPUT_PROMPTS_FILE],
        absolute: true,
      },
    );

    let outputContent = `/* eslint-disable */
/* prettier-ignore */
// Auto-generated by scripts/generate-prompts.ts
// Do not edit this file manually.

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as Handlebars from 'handlebars'; // Ensure consistent import

// It is expected that this generated file (prompts.ts) is in the same directory 
// as the .md (or .hbs) template files it references.
// If not, __dirname logic might need adjustment or paths made absolute from project root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); 

// --- Argument Types ---
`;

    const functionDefinitions: string[] = [];

    if (templateFilesPaths.length === 0) {
      console.log('No .md, .hbs, or .handlebars prompt templates found.');
      outputContent += '\n// No prompt templates found to generate functions for.\n';
    } else {
      for (const filePath of templateFilesPaths) {
        const result = await generateFunctionsForSinglePromptFile(filePath);
        if (result) {
          outputContent += result.typeDef + '\n';
          functionDefinitions.push(result.functionDef);
        }
      }
    }

    outputContent += '\n// --- Prompt Generation Functions ---\n';
    outputContent += functionDefinitions.join('\n');

    await fs.writeFile(OUTPUT_PROMPTS_FILE, outputContent);
    console.log(
      `Successfully generated ${templateFilesPaths.length} prompt function(s) into: ${OUTPUT_PROMPTS_FILE}`,
    );

    const watchMode = process.argv.includes('--watch');

    if (watchMode) {
      console.log(
        `Watching for changes in .md, .hbs, .handlebars files in ${PROMPTS_DIR} (excluding ${path.basename(OUTPUT_PROMPTS_FILE)})...`,
      );

      const watcher = watch(PROMPTS_DIR, { recursive: true }, async (event, filename) => {
        if (filename) {
          const fullPath = path.join(PROMPTS_DIR, filename); // filename might be relative to PROMPTS_DIR
          // Check if it's a template file and not the output file itself
          if (
            (fullPath.endsWith('.md') ||
              fullPath.endsWith('.hbs') ||
              fullPath.endsWith('.handlebars')) &&
            path.resolve(fullPath) !== path.resolve(OUTPUT_PROMPTS_FILE)
          ) {
            console.log(`Detected ${event} in ${filename}. Regenerating prompts...`);
            await regenerateAllPromptsFile();
          }
        } else if (event === 'rename') {
          // 'rename' events on the directory itself might indicate multiple changes or moves
          // It's safer to regenerate in this case.
          // filename might be null for directory renames.
          console.log(`Detected ${event} in ${PROMPTS_DIR}. Regenerating prompts...`);
          await regenerateAllPromptsFile();
        }
      });

      process.on('SIGINT', () => {
        console.log('Stopping watcher...');
        watcher.close();
        process.exit(0);
      });
    } else {
      console.log('Running in single-run mode (no --watch flag detected).');
    }
  } catch (error) {
    console.error('Error regenerating prompts file:', error);
    try {
      await fs.writeFile(
        OUTPUT_PROMPTS_FILE,
        `// Error during generation: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    } catch (writeError) {
      console.error('Failed to write error state to output file:', writeError);
    }
  }
}

async function main() {
  await regenerateAllPromptsFile();
}

main().catch(console.error);
