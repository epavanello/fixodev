#!/bin/sh
set -e

# Run database migrations
echo "Running database migrations..."
bun run db:migrate

# Execute the main command (passed as arguments to this script)
exec "$@" 