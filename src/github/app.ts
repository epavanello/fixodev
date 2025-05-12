import { envConfig } from '../config/env';
import { logger } from '../config/logger';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { GitHubError } from '../utils/error';

// This file handles GitHub App authentication
// It generates a JWT for API access and manages installation tokens

export class GitHubApp {
  private appId: string;
  private privateKey: string;
  private auth: ReturnType<typeof createAppAuth>;

  constructor() {
    this.appId = envConfig.GITHUB_APP_ID;
    this.privateKey = envConfig.GITHUB_PRIVATE_KEY;

    // Validate required configuration
    if (!this.appId || !this.privateKey) {
      throw new Error(
        'GitHub App configuration is missing. Check GITHUB_APP_ID and GITHUB_PRIVATE_KEY environment variables.',
      );
    }

    // Initialize the auth instance
    this.auth = createAppAuth({
      appId: this.appId,
      privateKey: this.privateKey,
    });
  }

  /**
   * Get an authenticated Octokit client for a specific installation
   */
  public async getAuthenticatedClient(installationId: number): Promise<Octokit> {
    try {
      logger.info({ installationId }, 'Getting installation token');

      // Get installation token
      const { token } = await this.auth({
        type: 'installation',
        installationId,
      });

      // Create and return authenticated Octokit client
      return new Octokit({
        auth: token,
      });
    } catch (error) {
      logger.error({ installationId, error }, 'Failed to get installation token');
      throw new GitHubError(
        `Failed to get installation token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get a JWT for GitHub App authentication
   */
  public async getJWT(): Promise<string> {
    try {
      logger.info('Getting JWT for GitHub App');

      // Get JWT
      const { token } = await this.auth({
        type: 'app',
      });

      return token;
    } catch (error) {
      logger.error({ error }, 'Failed to get JWT');
      throw new GitHubError(
        `Failed to get JWT: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
