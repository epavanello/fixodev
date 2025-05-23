# ---- Builder Stage ----
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Copy package.json and install all dependencies (including devDependencies)
# This step also generates/updates bun.lockb
COPY package.json ./
RUN bun install

# Copy source code required for the build
COPY src ./src
COPY prompts ./prompts
COPY build.ts ./
COPY tsconfig.json ./
COPY drizzle.config.ts ./

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

# Copy package.json and bun.lockb from the builder stage
COPY --from=builder /app/package.json /app/bun.lock /app/drizzle.config.ts /app/src/db/schema.ts ./

# Install only production dependencies using the locked versions
RUN bun install --production --no-optional

# Copy the built application (dist directory) from the builder stage
COPY --from=builder /app/dist ./

# Create data directories
RUN mkdir -p data repos

# Expose the application port
EXPOSE 3000

RUN bun run db:migrate

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["bun", "app.js"] 