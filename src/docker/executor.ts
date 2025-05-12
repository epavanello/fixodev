import { docker, Runtime, getRuntimeImage } from './index';
import { logger } from '../config/logger';

// --- Constants ---
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CONTAINER_MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024; // 1GB

interface ExecuteCommandOptions {
  runtime: Runtime;
  workspacePath: string;
  command: string;
  timeout?: number;
  memoryLimitBytes?: number;
}

interface ExecutionResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

// Helper to create a timeout promise and manage its timer
interface TimeoutData<T> {
  promise: Promise<T>;
  timerId?: NodeJS.Timeout;
}

const createTimeoutPromise = (
  timeoutMs: number,
  onTimeout: () => void,
): TimeoutData<ExecutionResult> => {
  let timerId: NodeJS.Timeout | undefined;
  const promise = new Promise<ExecutionResult>(resolve => {
    timerId = setTimeout(() => {
      onTimeout(); // Execute the provided callback (e.g., kill container)
      resolve({
        success: false,
        output: 'Command execution timed out',
        exitCode: null,
      });
    }, timeoutMs);
  });
  return { promise, timerId };
};

/**
 * Execute a command in a Docker container
 */
export const executeCommand = async (options: ExecuteCommandOptions): Promise<ExecutionResult> => {
  const {
    runtime,
    workspacePath,
    command,
    timeout = DEFAULT_TIMEOUT_MS,
    memoryLimitBytes = CONTAINER_MEMORY_LIMIT_BYTES,
  } = options;

  logger.info({ runtime, command, timeout, memoryLimitBytes }, 'Executing command in container');

  try {
    // Get image name
    const imageName = getRuntimeImage(runtime);
    logger.info({ imageName }, 'Ensuring Docker image exists');

    // Attempt to pull the image explicitly
    // This handles cases where the image might not be local
    // and ensures it's up-to-date (though pull defaults might vary)
    await docker.pull(imageName);
    logger.info({ imageName }, 'Docker image pulled successfully or already exists');

    // Create container
    const container = await docker.createContainer({
      Image: imageName,
      Cmd: ['sh', '-c', command],
      HostConfig: {
        Binds: [`${workspacePath}:/workspace:ro`],
        Memory: memoryLimitBytes,
        MemorySwap: memoryLimitBytes,
        NetworkMode: 'none',
      },
      WorkingDir: '/workspace',
    });

    try {
      // Start container
      await container.start();

      // --- Timeout Setup ---
      const timeoutData = createTimeoutPromise(timeout, () => {
        container
          .kill()
          .catch(err =>
            logger.warn({ err }, 'Failed to kill container on timeout, maybe already stopped.'),
          );
      });
      const timeoutPromise = timeoutData.promise; // The actual promise for the race

      // --- Execution IIAFE ---
      const executionPromise = (async (): Promise<ExecutionResult> => {
        try {
          // Wait for container to exit
          const { StatusCode: exitCode } = await container.wait();

          // Clear the timeout if execution finishes first
          if (timeoutData.timerId) {
            clearTimeout(timeoutData.timerId);
          }

          // Get container logs AFTER waiting
          const logs = await container.logs({
            stdout: true,
            stderr: true,
            follow: false,
          });

          const output = logs.toString('utf8');
          return {
            success: exitCode === 0,
            output,
            exitCode,
          };
        } catch (error) {
          // Clear the timeout if execution fails first
          if (timeoutData.timerId) {
            clearTimeout(timeoutData.timerId);
          }

          // Handle potential errors during wait() or logs()
          const isError = error instanceof Error;
          const errorMessage = isError ? error.message : String(error);

          // Avoid logging "No such container" if it might be expected after kill()
          if (!(isError && errorMessage.includes('No such container'))) {
            logger.error({ error }, 'Error waiting for container or getting logs');
          }

          return {
            success: false,
            output: `Error: ${errorMessage}`,
            exitCode: null,
          };
        }
      })(); // Immediately invoke the async function

      // Race between execution and timeout
      return await Promise.race([executionPromise, timeoutPromise]); // await the race result
    } finally {
      logger.debug({ containerId: container.id }, 'Ensuring container removal');
      try {
        await container.remove({ force: true });
        logger.info({ containerId: container.id }, 'Container removed successfully');
      } catch (removeError) {
        // Log error if removal fails, but don't let it crash the main function
        // Avoid logging "No such container" if it was already removed (e.g., race condition with kill+remove)
        const isError = removeError instanceof Error;
        const shouldLog = !(isError && removeError.message.includes('No such container'));

        if (shouldLog) {
          logger.error({ containerId: container.id, removeError }, 'Failed to remove container');
        }
      }
    }
  } catch (error) {
    logger.error(error, 'Failed to execute command in container (setup phase)');
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: null,
    };
  }
};
