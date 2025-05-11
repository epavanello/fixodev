FROM node:20-alpine

WORKDIR /app

# Install Docker CLI
RUN apk add --no-cache docker curl

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .
RUN npm run build

# Create data directories
RUN mkdir -p data repos

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/app.js"] 