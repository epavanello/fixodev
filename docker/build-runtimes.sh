#!/bin/bash

# Exit on error
set -e

# Get the Docker runtime prefix from environment or use default
DOCKER_RUNTIME_PREFIX=${DOCKER_RUNTIME_PREFIX:-ghbot}

# Build Node.js 18 runtime
echo "Building Node.js 18 runtime..."
docker build -t ${DOCKER_RUNTIME_PREFIX}/node:18 -f runtimes/node18/Dockerfile .

# Build Node.js 20 runtime
echo "Building Node.js 20 runtime..."
docker build -t ${DOCKER_RUNTIME_PREFIX}/node:20 -f runtimes/node20/Dockerfile .

echo "Runtime images built successfully!" 