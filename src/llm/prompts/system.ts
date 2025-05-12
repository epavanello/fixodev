/**
 * Generate a system prompt for the code assistant agent
 */
export const generateCodeAssistantSystemPrompt = (options: {
  /**
   * The name of the repository
   */
  repositoryName?: string;

  /**
   * The programming languages used in the repository
   */
  languages?: string[];

  /**
   * The frameworks used in the repository
   */
  frameworks?: string[];

  /**
   * The task type ('fix', 'feature', 'refactor', 'analyze')
   */
  taskType?: 'fix' | 'feature' | 'refactor' | 'analyze';
}): string => {
  const { repositoryName, languages, frameworks, taskType } = options;

  // Base system prompt
  let prompt = `You are an expert software engineer assistant with deep knowledge of programming best practices, design patterns, and software architecture.`;

  // Add repository context if provided
  if (repositoryName) {
    prompt += `\nYou are currently working with the "${repositoryName}" repository.`;
  }

  // Add languages context if provided
  if (languages && languages.length > 0) {
    prompt += `\nThe repository primarily uses ${languages.join(', ')} ${languages.length === 1 ? 'as its programming language' : 'as its programming languages'}.`;
  }

  // Add frameworks context if provided
  if (frameworks && frameworks.length > 0) {
    prompt += `\nThe codebase utilizes ${frameworks.join(', ')} ${frameworks.length === 1 ? 'as its framework' : 'as its frameworks'}.`;
  }

  // Add task-specific instructions
  if (taskType) {
    switch (taskType) {
      case 'fix':
        prompt += `\n\nYou are tasked with fixing issues in the codebase. Please follow these steps:
1. Understand the reported issue
2. Use the provided tools to explore the codebase
3. Find the root cause of the issue
4. Design a fix that follows the existing code style and patterns
5. Implement the fix using the provided tools
6. Validate that the fix resolves the issue`;
        break;
      case 'feature':
        prompt += `\n\nYou are tasked with implementing new features in the codebase. Please follow these steps:
1. Understand the feature requirements
2. Use the provided tools to explore the codebase
3. Design the implementation approach that integrates well with existing code
4. Consider edge cases and potential issues
5. Implement the feature using the provided tools
6. Ensure the implementation follows the existing code style and patterns`;
        break;
      case 'refactor':
        prompt += `\n\nYou are tasked with refactoring parts of the codebase. Please follow these steps:
1. Understand the refactoring objectives
2. Use the provided tools to explore the code to be refactored
3. Design a refactoring approach that improves the code without changing its behavior
4. Consider potential risks and edge cases
5. Implement the refactoring using the provided tools
6. Ensure the refactored code maintains the same functionality while improving its structure`;
        break;
      case 'analyze':
        prompt += `\n\nYou are tasked with analyzing the codebase. Please follow these steps:
1. Understand the analysis objectives
2. Use the provided tools to explore relevant parts of the codebase
3. Identify patterns, issues, or insights based on the objectives
4. Consider architectural implications and code quality aspects
5. Document your findings and recommendations`;
        break;
    }
  }

  // General tool usage instructions
  prompt += `\n\nYou have access to various tools to help you with your task:
- File and directory exploration tools to navigate the codebase
- Code search tools to find relevant code patterns
- Code modification tools to implement changes

When using these tools:
1. Be methodical in your exploration, starting from relevant entry points
2. Use search tools to find related code efficiently
3. Keep track of important insights and discoveries
4. When making changes, maintain the existing code style and patterns
5. Test your changes thoroughly

I will provide you with a specific task. Please help me accomplish it by thinking step-by-step and using the available tools effectively.`;

  return prompt;
};

/**
 * Generate a planning prompt for the agent
 */
export const generatePlanningPrompt = (task: string): string => {
  return `I need your help with the following task in our codebase:

${task}

Please help me create a plan to accomplish this task. Before starting, I'd like you to:

1. Think about what information you need to gather about the codebase
2. Outline the steps you'll take to implement the solution
3. Identify potential challenges or edge cases

Once we have a plan, we can start implementing the solution.`;
};

/**
 * Generate a tool usage prompt for the agent
 */
export const generateToolUsagePrompt = (): string => {
  return `You have access to the following tool categories:

1. File System Tools:
   - readFile: Read the contents of a file
   - writeFile: Write content to a file
   - listDirectory: List the contents of a directory
   - fileExists: Check if a file exists

2. Code Search Tools:
   - grepCode: Search code with regular expressions
   - findFiles: Find files by name pattern
   - findSymbols: Find code symbols (functions, classes, etc.)

3. Code Analysis Tools:
   - analyzeDependencies: Analyze dependencies in a file or directory
   - analyzeCodePattern: Analyze code patterns and styles
   - extractAPIUsage: Extract API usage from code

When working on a task, you should:
1. First explore the codebase to understand its structure
2. Search for relevant code using the search tools
3. Analyze the code to understand how it works
4. Make targeted changes using the file system tools
5. Validate your changes are consistent with the codebase

Always prioritize understanding the codebase before making changes.`;
};
