import { logger } from '@/config/logger';

export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

/**
 * OperationLogger provides structured logging with context propagation and error handling.
 *
 * @example
 * ```typescript
 * // Create a logger with base context
 * const jobLogger = new OperationLogger({
 *   jobId: 'job-123',
 *   jobType: 'issue_to_pr',
 *   repo: 'owner/repo'
 * });
 *
 * // For critical operations that should fail fast
 * const result = await jobLogger.execute(
 *   () => someAsyncOperation(),
 *   'perform critical operation',
 *   { additionalContext: 'value' }
 * );
 *
 * // For optional operations that shouldn't break the flow
 * const safeResult = await jobLogger.safe(
 *   () => optionalOperation(),
 *   'perform optional operation'
 * );
 * if (!safeResult.ok) {
 *   // Handle error gracefully, logging already done
 * }
 *
 * // Create child logger with additional context
 * const stepLogger = jobLogger.child({ step: 'authentication' });
 *
 * // Use default logger for spot operations
 * await defaultLogger.execute(() => spotOperation(), 'spot operation');
 * ```
 */
export class OperationLogger {
  constructor(private context: Record<string, unknown>) {}

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Record<string, unknown>) {
    return new OperationLogger({ ...this.context, ...additionalContext });
  }

  /**
   * Execute an async operation with automatic logging.
   * Throws on error (fail-fast behavior).
   *
   * @param operation - The async operation to execute
   * @param action - Description of the action for logging
   * @param meta - Additional metadata for this operation
   */
  async execute<T>(
    operation: () => Promise<T>,
    action: string,
    meta?: Record<string, unknown>,
  ): Promise<T> {
    const fullContext = { ...this.context, ...meta };
    try {
      const result = await operation();
      logger.info(fullContext, `✅ ${action}`);
      return result;
    } catch (error) {
      logger.error({ ...fullContext, error }, `❌ ${action}`);
      throw error;
    }
  }

  /**
   * Execute an async operation safely, returning a Result type.
   * Never throws, always returns success/error state.
   *
   * @param operation - The async operation to execute
   * @param action - Description of the action for logging
   * @param meta - Additional metadata for this operation
   */
  async safe<T>(
    operation: () => Promise<T>,
    action: string,
    meta?: Record<string, unknown>,
  ): Promise<Result<T>> {
    try {
      const data = await this.execute(operation, action, meta);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }

  /**
   * Execute a synchronous operation with automatic logging.
   * Throws on error (fail-fast behavior).
   */
  sync<T>(operation: () => T, action: string, meta?: Record<string, unknown>): T {
    const fullContext = { ...this.context, ...meta };
    try {
      const result = operation();
      logger.info(fullContext, `✅ ${action}`);
      return result;
    } catch (error) {
      logger.error({ ...fullContext, error }, `❌ ${action}`);
      throw error;
    }
  }

  /**
   * Execute a synchronous operation safely, returning a Result type.
   * Never throws, always returns success/error state.
   */
  safSync<T>(operation: () => T, action: string, meta?: Record<string, unknown>): Result<T> {
    try {
      const data = this.sync(operation, action, meta);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }

  /**
   * Log an info message with context
   */
  info(message: string, meta?: Record<string, unknown>) {
    logger.info({ ...this.context, ...meta }, message);
  }

  /**
   * Log an error message with context
   */
  error(message: string, error?: Error, meta?: Record<string, unknown>) {
    logger.error({ ...this.context, ...meta, error }, message);
  }

  /**
   * Log a warning message with context
   */
  warn(message: string, meta?: Record<string, unknown>) {
    logger.warn({ ...this.context, ...meta }, message);
  }
}

/**
 * Default OperationLogger instance for spot usage where no specific context is available.
 * Use this for one-off operations or when you don't have a specific context to attach.
 *
 * @example
 * ```typescript
 * import { defaultLogger } from '@/utils/logger';
 *
 * // For spot operations without specific context
 * await defaultLogger.execute(() => someOperation(), 'perform operation', { meta: 'data' });
 *
 * // Create a contextual logger from default
 * const contextLogger = defaultLogger.child({ module: 'worker', operation: 'job-processing' });
 * ```
 */
export const defaultLogger = new OperationLogger({ context: 'default' });
