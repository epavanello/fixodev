import Dockerode from 'dockerode';
import { logger } from '../config/logger';
import { envConfig } from '../config/env';

// Initialize Docker client
const docker = new Dockerode();

// Runtime image prefix
const RUNTIME_PREFIX = envConfig.DOCKER_RUNTIME_PREFIX;

// Available runtime images
export enum Runtime {
  NODE_18 = 'node:18',
  NODE_20 = 'node:20',
}

/**
 * Get Docker image name for runtime
 */
export const getRuntimeImage = (runtime: Runtime): string => {
  return `${RUNTIME_PREFIX}/${runtime}`;
};

/**
 * Check if Docker is available
 */
export const checkDockerAvailability = async (): Promise<boolean> => {
  try {
    const info = await docker.info();
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
