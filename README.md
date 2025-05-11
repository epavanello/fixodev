# GitHub Bot

A GitHub App-based bot that automates code fixes and improvements through AI.

## Features

- GitHub App with webhook handling
- Containerized execution environment
- AI-powered code fixes using LLM
- Automated PR creation

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `env.example` to `.env` and fill in the required values
4. Start the development server: `npm run dev`

## Architecture

- Fastify server for webhook handling
- In-memory queue system with disk persistence
- Docker-based execution for security and isolation
- OpenAI integration for code analysis and fixes

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Lint code
npm run lint

# Format code
npm run format

# Build for production
npm run build

# Start production server
npm run start
```

## License

MIT
