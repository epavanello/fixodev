# RepoSister Bot

A GitHub App-based bot that automates code fixes and improvements through AI.

## Features

- GitHub App with webhook handling
- Containerized execution environment
- AI-powered code fixes using LLM
- Automated PR creation
- **Advanced Embedding and Indexing**: Future capabilities include advanced indexing and code understanding by employing embeddings for better context retrieval and handling of code modifications.

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

- **GitHub App Server**: Built using Bun HTTP server to receive and handle webhooks, with authentication and event subscription tailored for GitHub operations.
- **Queue System**: Implements an in-memory FIFO queue with optional disk persistence, featuring error handling and retry mechanisms.
- **Docker Orchestration**: Manages isolated execution environments for job security and resource constraints using Dockerode.
- **LLM Integration**: Utilizes OpenAI's GPT-4 for performing code analysis and enhancements via systematic prompt templates.
- **Git Operations**: Employs simple-git for managing repository cloning, branch creations, commit operations, and PR submissions.

## Technical Specifications

- **HTTP Server**: Bun
- **Queue System**: In-memory with disk persistence support
- **Docker Management**: Dockerode
- **Language Model**: OpenAI GPT-4
- **Git Client**: simple-git

## Bot Configuration

Customize the bot's behavior using the `.bot-config.yml` file within your repositories:

```yaml
runtime: bun:latest
scripts:
  lint: bun run lint
  test: bun run test
  format: bun run format
autofix: true
branches:
  autofix: true
  target: main
```

## Deployment Details

The application can be deployed using Docker and Docker Compose. 

- **Docker Compose**: A docker-compose.yml file is provided, specifying service configurations for running the app in a containerized setup with mounted volumes for persistence.
- **Dockerfile**: Contains instructions to build the application image, including dependency installation and environment configuration.

## Project Structure

```
/
├── src/
│   ├── app.ts                # Entry point for Bun app
│   ├── config/               # Configurations
│   ├── github/               # GitHub App logic and handlers
│   ├── queue/                # Queue implementation
│   ├── docker/               # Docker orchestration code
│   ├── llm/                  # Code for LLM integration
│   ├── git/                  # Git operations management
│   └── utils/                # Utility functions and shared logic
├── test/                     # Test suite
├── docker/                   # Docker-related files
│   └── runtimes/             # Prebuilt images
├── docker-compose.yml        # Docker Compose configuration
├── .env.example              # Environment variables template
├── tsconfig.json             # TypeScript configuration
└── package.json              # Project dependencies
```

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

Business Source License 1.1 (BSL 1.1)
