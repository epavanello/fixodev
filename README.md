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

To run the RepoSister Bot, you need to configure the following environment variables:

| Variable                  | Mandatory | Default Value                | Description                                      |
|---------------------------|-----------|------------------------------|--------------------------------------------------|
| GITHUB_APP_ID             | Yes       | None                         | The GitHub Application ID for the bot.          |
| GITHUB_PRIVATE_KEY        | Yes       | None                         | The private key for the GitHub App.             |
| GITHUB_WEBHOOK_SECRET     | Yes       | None                         | Secret used to verify the authenticity of webhook events.
| OPENAI_API_KEY            | Yes       | None                         | API key for OpenAI to enable AI functionalities. |

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
