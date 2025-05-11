FROM node:20-alpine

# Install common development tools
RUN apk add --no-cache \
    git \
    curl \
    python3 \
    make \
    g++ \
    bash

# Create workspace directory
WORKDIR /workspace

# Set environment variables
ENV NODE_ENV=development
ENV PATH=/workspace/node_modules/.bin:$PATH

# Default command
CMD ["sh"] 