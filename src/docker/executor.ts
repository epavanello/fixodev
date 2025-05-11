import { docker, Runtime, getRuntimeImage } from './index';
import { logger } from '../config/logger';

interface ExecuteCommandOptions {
  runtime: Runtime;
  workspacePath: string;
  command: string;
  timeout?: number;
}

interface ExecutionResult {
  success: boolean;
  output: string;
  exitCode: number | null;
}

/**
 * Execute a command in a Docker container
 */
export const executeCommand = async (options: ExecuteCommandOptions): Promise<ExecutionResult> => {
  const {
    runtime,
    workspacePath,
    command,
    timeout = 10 * 60 * 1000, // 10 minutes default timeout
  } = options;

  logger.info({ runtime, command }, 'Executing command in container');

  try {
    // Create container
    const container = await docker.createContainer({
      Image: getRuntimeImage(runtime),
      Cmd: ['sh', '-c', command],
      HostConfig: {
        Binds: [`${workspacePath}:/workspace:ro`],
        Memory: 1024 * 1024 * 1024, // 1GB
        MemorySwap: 1024 * 1024 * 1024, // 1GB
        NetworkMode: 'none',
        AutoRemove: true,
      },
      WorkingDir: '/workspace',
    });

    // Start container
    await container.start();

    // Set execution timeout
    const timeoutPromise = new Promise<ExecutionResult>(resolve => {
      setTimeout(() => {
        container.kill().catch(() => {});
        resolve({
          success: false,
          output: 'Command execution timed out',
          exitCode: null,
        });
      }, timeout);
    });

    // Wait for container to finish
    const executionPromise = new Promise<ExecutionResult>(async resolve => {
      try {
        // Wait for container to exit
        const { StatusCode: exitCode } = await container.wait();

        // Get container logs
        const logs = await container.logs({
          stdout: true,
          stderr: true,
          follow: false,
        });

        // Convert Buffer to string
        const output = logs.toString('utf8');

        resolve({
          success: exitCode === 0,
          output,
          exitCode,
        });
      } catch (error) {
        logger.error(error, 'Error waiting for container');
        resolve({
          success: false,
          output: `Error: ${error instanceof Error ? error.message : String(error)}`,
          exitCode: null,
        });
      }
    });

    // Race between execution and timeout
    return Promise.race([executionPromise, timeoutPromise]);
  } catch (error) {
    logger.error(error, 'Failed to execute command in container');
    return {
      success: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: null,
    };
  }
};
