import Dockerode from 'dockerode';
import { logger } from '../config/logger';
import { envConfig } from '../config/env';

// Initialize Docker client
const docker = new Dockerode();

// Runtime image prefix
const RUNTIME_PREFIX = envConfig.DOCKER_RUNTIME_PREFIX;

// Available runtime images
export type Runtime = 'node' | 'python' | 'ruby' | 'php' | 'go' | 'rust' | 'java' | 'dotnet';

/**
 * Get Docker image name for runtime
 */
export const getRuntimeImage = (runtime: Runtime): string => {
  if (RUNTIME_PREFIX) {
    return `${RUNTIME_PREFIX}/${runtime}`;
  }
  return `${runtime}`;
};

/**
 * Check if Docker is available
 */
export const checkDockerAvailability = async (): Promise<boolean> => {
  try {
    await docker.info();
    logger.info('Docker is available');
    return true;
  } catch (error) {
    logger.error(error, 'Docker is not available');
    return false;
  }
};

/**
 * List available images
 */
export const listImages = async (): Promise<string[]> => {
  try {
    const images = await docker.listImages();
    return images
      .map(image => {
        if (image.RepoTags) {
          return image.RepoTags[0];
        }
        return '';
      })
      .filter(Boolean);
  } catch (error) {
    logger.error(error, 'Failed to list Docker images');
    return [];
  }
};

// Export Docker client
export { docker };
