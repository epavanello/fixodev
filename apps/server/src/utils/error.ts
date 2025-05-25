/**
 * Base application error
 */
export class AppError extends Error {
  code: string;

  constructor(message: string, code = 'APP_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for GitHub API related issues
 */
export class GitHubError extends AppError {
  constructor(message: string, code = 'GITHUB_ERROR') {
    super(message, code);
  }
}

/**
 * Error for Docker related issues
 */
export class DockerError extends AppError {
  constructor(message: string, code = 'DOCKER_ERROR') {
    super(message, code);
  }
}

/**
 * Error for OpenAI API related issues
 */
export class OpenAIError extends AppError {
  constructor(message: string, code = 'OPENAI_ERROR') {
    super(message, code);
  }
}

/**
 * Error for Git operations
 */
export class GitError extends AppError {
  constructor(message: string, code = 'GIT_ERROR') {
    super(message, code);
  }
}

/**
 * Error for repository configuration
 */
export class ConfigError extends AppError {
  constructor(message: string, code = 'CONFIG_ERROR') {
    super(message, code);
  }
}

/**
 * Error for job processing
 */
export class JobError extends AppError {
  constructor(message: string, code = 'JOB_ERROR') {
    super(message, code);
  }
}
