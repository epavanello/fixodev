FROM oven/bun:1

WORKDIR /app

# Install Docker CLI
RUN apt-get update && apt-get install -y docker.io curl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN bun install --production

# Copy application code
COPY . .
RUN bun run build

# Create data directories
RUN mkdir -p data repos

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["bun", "dist/app.js"] 