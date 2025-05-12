import { CodeContext } from '../processor';

/**
 * Generate a prompt for fixing code issues
 */
export const generateFixPrompt = (code: string, issue: string, context: CodeContext): string => {
  const contextInfo = context
    ? `
Context:
- File: ${context.filePath || 'unknown'}
- Language: ${context.language || 'unknown'}
- Dependencies: ${context.dependencies?.join(', ') || 'none'}
`
    : '';

  return `You are a professional developer fixing the following issue:
${issue}

${contextInfo}
Here is the code that needs fixing:
\`\`\`
${code}
\`\`\`

Please provide only the corrected code with no explanations. The code should be complete and ready to use.`;
};

/**
 * Generate a prompt for fixing linting issues
 */
export const generateLintFixPrompt = (
  code: string,
  lintErrors: string[],
  context: CodeContext,
): string => {
  const contextInfo = context
    ? `
Context:
- File: ${context.filePath || 'unknown'}
- Language: ${context.language || 'unknown'}
- Linter: ${context.linter || 'unknown'}
`
    : '';

  return `You are a professional developer fixing the following linting issues:
${lintErrors.join('\n')}

${contextInfo}
Here is the code that needs fixing:
\`\`\`
${code}
\`\`\`

Please provide only the corrected code with no explanations. The code should be complete and ready to use.`;
};

/**
 * Generate a prompt for fixing test failures
 */
export const generateTestFixPrompt = (
  code: string,
  testOutput: string,
  context: CodeContext,
): string => {
  const contextInfo = context
    ? `
Context:
- File: ${context.filePath || 'unknown'}
- Language: ${context.language || 'unknown'}
- Test Framework: ${context.testFramework || 'unknown'}
`
    : '';

  return `You are a professional developer fixing the following test failures:
${testOutput}

${contextInfo}
Here is the code that needs fixing:
\`\`\`
${code}
\`\`\`

Please provide only the corrected code with no explanations. The code should be complete and ready to use.`;
};
