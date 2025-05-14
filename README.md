# RepoSister Bot

A GitHub App-based bot that automates code fixes and improvements through AI.

## Features

- GitHub App with webhook handling
- Containerized execution environment
- AI-powered code fixes using LLM
- Automated PR creation

## Setup

1. Clone the repository
2. Install dependencies: `bun install`
3. Copy `env.example` to `.env` and fill in the required values
4. Start the development server: `bun run dev`
5. Run the CLI: `bun run cli`

## Environment Variables

The following environment variables are mandatory for the application to run:

- `GITHUB_APP_ID`: Your GitHub App ID. [Example: 123456]
- `GITHUB_PRIVATE_KEY`: The private key for your GitHub App. [Example: -----BEGIN PRIVATE KEY-----\n...
-----END PRIVATE KEY-----]
- `GITHUB_WEBHOOK_SECRET`: The secret used to verify webhook payloads. [Example: myWebhookSecret]
- `OPENAI_API_KEY`: Your OpenAI API key for AI functionality. [Example: sk-...]

Please ensure all the mandatory environment variables are set before starting the application.

## Architecture

- Bun HTTP server for webhook handling
- In-memory queue system with disk persistence
- Docker-based execution for security and isolation
- OpenAI integration for code analysis and fixes

## Development

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run the CLI
bun run cli

# Lint code
bun run lint

# Format code
bun run format

# Build for production
bun run build

# Start production server
bun run start
```

## License

MIT

