# RepoSister Bot

A GitHub App-based bot that automates code fixes and improvements through AI.

## How to use

1. Install the GitHub App on your repository.
2. Configure the app settings as needed in your GitHub repository settings.
3. Trigger the bot using one of the following ways (bot name: `@RepoSister`):
    1. by pushing code changes to your repository
    1. by creating an issue mentioning the bot
    1. by creating a pull request mentioning the bot
    1. by commenting on the pull request mentioning the bot

## Features

- GitHub App with webhook handling
- Containerized execution environment
- AI-powered code fixes using LLM
- Automated PR creation

## Supported Tools

- **readonlyTools**: Tools that allow reading from the codebase without making modifications.
- **writableTools**: Tools that can modify the codebase, enabling the bot to apply fixes and improvements.
- **searchTools**: Tools that assist in searching through the codebase for specific patterns or files.

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

## Architecture & Core Components

- **GitHub App Server**: Built on Bun HTTP server, handling webhooks and app authentication using JWT, with endpoints for events like `issue_comment`, `pull_request`, and `push`.
- **Queue System**: In-memory FIFO queue with persistence to disk, designed for effective job status tracking and retry mechanisms.
- **Docker Orchestration**: Executes scripts in isolated containers using `dockerode`, ensuring secure execution with network isolation and resource limits.
- **LLM Integration**: Uses OpenAI's API for code analysis and auto-fixing, employing systematic prompt templates for task-specific queries.
- **Git Operations**: Manages repository cloning, branch creation, commit, and PR actions via GitHub API.

## Deployment Strategies

Deployment is streamlined using Docker Compose.

### Docker Compose Setup
```yaml
docker-compose.yml configuration includes services for a Bun-based application with options for environment variables, volume mounts, and networking.
```
- **Dockerfile** includes instructions to build the application image, incorporating Bun runtime and required dependencies.

## Potential Use Cases

- Automated linting and formatting for open source projects.
- Contribution to repositories through auto-generated PRs based on specific issue tags.
- Continuous integration pipelines, benefiting from automatic fixes and code standards assurance.

## Additional Documentation

For more in-depth details, refer to the following documents:
- [MVP.md](docs/MVP.md)
- [Technical Implementation Document.md](docs/Technical%20Implementation%20Document.md)

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
