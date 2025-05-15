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
   - **Mandatory Environment Variables:**  
     - `GITHUB_APP_ID`: Your GitHub App ID.  
     - `GITHUB_PRIVATE_KEY`: Your GitHub Private Key for app authentication.  
     - `GITHUB_WEBHOOK_SECRET`: Secret for verifying incoming webhooks.  
     - `OPENAI_API_KEY`: API key for OpenAI services.
4. Start the development server: `bun run dev`
5. Run the CLI: `bun run cli`

## Architecture

- Bun HTTP server for webhook handling
- In-memory queue system with disk persistence
- Docker-based execution for security and isolation
- OpenAI integration for code analysis and fixes

## License

Business Source License 1.1 (BSL 1.1)
