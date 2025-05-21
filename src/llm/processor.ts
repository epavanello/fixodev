  } catch (error) {
    logger.error(
      { modificationRequest, repositoryPath, error },
      'Failed to process code modification request',
    );
    return {
      error: {
        message: `Failed to process code modification request: ${error instanceof Error ? error.message : String(error)}`,
        code: 'GITHUB_ERROR',
      },
    };
  }
};
