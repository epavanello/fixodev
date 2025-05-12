import { CodeContext } from '../processor';

/**
 * Generate a prompt for analyzing code quality
 */
export const generateQualityAnalysisPrompt = (
  code: string,
  context?: {
    filePath?: string;
    language?: string;
    dependencies?: string[];
  },
): string => {
  const contextInfo = context
    ? `
Context:
- File: ${context.filePath || 'unknown'}
- Language: ${context.language || 'unknown'}
- Dependencies: ${context.dependencies?.join(', ') || 'none'}
`
    : '';

  return `You are a professional code reviewer analyzing the following code:
${contextInfo}
\`\`\`
${code}
\`\`\`

Please analyze the code and provide:
1. Code quality issues (e.g., complexity, readability, maintainability)
2. Potential bugs or edge cases
3. Performance concerns
4. Security vulnerabilities
5. Suggestions for improvement

Format your response as a JSON object with the following structure:
{
  "quality": ["issue1", "issue2", ...],
  "bugs": ["bug1", "bug2", ...],
  "performance": ["concern1", "concern2", ...],
  "security": ["vulnerability1", "vulnerability2", ...],
  "improvements": ["suggestion1", "suggestion2", ...]
}`;
};

/**
 * Generate a prompt for analyzing code dependencies
 */
export const generateDependencyAnalysisPrompt = (
  code: string,
  dependencies: string[],
  context?: {
    filePath?: string;
    language?: string;
  },
): string => {
  const contextInfo = context
    ? `
Context:
- File: ${context.filePath || 'unknown'}
- Language: ${context.language || 'unknown'}
`
    : '';

  return `You are a professional developer analyzing dependencies in the following code:
${contextInfo}
\`\`\`
${code}
\`\`\`

Current dependencies:
${dependencies.join('\n')}

Please analyze the code and provide:
1. Unused dependencies that can be removed
2. Missing dependencies that should be added
3. Outdated dependencies that should be updated
4. Potential dependency conflicts
5. Security vulnerabilities in dependencies

Format your response as a JSON object with the following structure:
{
  "unused": ["dependency1", "dependency2", ...],
  "missing": ["dependency1", "dependency2", ...],
  "outdated": ["dependency1", "dependency2", ...],
  "conflicts": ["conflict1", "conflict2", ...],
  "vulnerabilities": ["vulnerability1", "vulnerability2", ...]
}`;
};

/**
 * Generate a prompt for analyzing code architecture
 */
export const generateArchitectureAnalysisPrompt = (
  code: string,
  context?: {
    filePath?: string;
    language?: string;
    projectType?: string;
  },
): string => {
  const contextInfo = context
    ? `
Context:
- File: ${context.filePath || 'unknown'}
- Language: ${context.language || 'unknown'}
- Project Type: ${context.projectType || 'unknown'}
`
    : '';

  return `You are a professional software architect analyzing the following code:
${contextInfo}
\`\`\`
${code}
\`\`\`

Please analyze the code and provide:
1. Architectural patterns used
2. Design principles followed or violated
3. Code organization and structure
4. Coupling and cohesion issues
5. Scalability and maintainability concerns

Format your response as a JSON object with the following structure:
{
  "patterns": ["pattern1", "pattern2", ...],
  "principles": {
    "followed": ["principle1", "principle2", ...],
    "violated": ["principle1", "principle2", ...]
  },
  "structure": ["observation1", "observation2", ...],
  "coupling": ["issue1", "issue2", ...],
  "scalability": ["concern1", "concern2", ...]
}`;
};

/**
 * Generate a prompt for analyzing repository changes
 */
export const generateRepositoryAnalysisPrompt = (
  repositoryPath: string,
  context: CodeContext,
): string => {
  return `You are a professional developer. Analyze the repository and suggest changes based on the following command:
"${context.command}"

Repository path: ${repositoryPath}
Language: ${context.language || 'unknown'}

Please analyze the repository and provide a list of changes needed to implement the command.
For each change, specify:
1. The file path that needs to be modified
2. A description of what changes are needed
3. Any dependencies that need to be updated (if applicable)

Format your response as a JSON object with the following structure:
{
  "changes": [
    {
      "filePath": "path/to/file",
      "description": "What changes are needed",
      "dependencies": ["dependency1", "dependency2"] // optional
    }
  ]
}`;
};
