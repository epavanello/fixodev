# ---- Builder Stage ----
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Create data directories
RUN mkdir -p data repos

# Copy package.json
COPY apps/server/package.json ./

RUN bun install

# Copy source code required for the build
COPY apps/server/src ./src
COPY apps/server/prompts ./prompts
COPY apps/server/scripts ./scripts
COPY apps/server/build.ts ./
COPY apps/server/tsconfig.json ./
COPY apps/server/drizzle.config.ts ./

# Run the build script (defined in package.json)
# This will create the /app/dist directory
RUN bun run build --sourcemap

# ---- Final Stage ----
FROM oven/bun:1.2

WORKDIR /app

# Install only essential Docker packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    docker.io \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json from the builder stage
COPY --from=builder /app/package.json ./

# Install only production dependencies
RUN bun install --production --no-optional

# Copy the built application (dist directory) from the builder stage
COPY --from=builder /app/dist ./

COPY apps/server/drizzle.config.ts ./
COPY apps/server/src/db/schema.ts ./src/db/schema.ts

# Copy the entrypoint script
COPY apps/server/entrypoint.sh .
RUN chmod +x ./entrypoint.sh

# Set environment variables for better performance
ENV NODE_ENV=production
ENV BUN_ENV=production

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Set the entrypoint
ENTRYPOINT ["./entrypoint.sh"]

# Start the application (this will be passed to entrypoint.sh)
CMD ["bun", "app.js"] 