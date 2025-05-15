# RepoSister Bot

A GitHub App-based bot that automates code fixes and improvements through AI.

## Vision and Strategic Goals

RepoSister Bot aims to streamline the code management process by leveraging AI to automate code improvements. Our strategic goals include providing a fully automated, secure, and containerized service that supports advanced indexing and code understanding capabilities. Future iterations will focus on expanding runtime supports and enhancing AI-driven analysis features.

## Features

- GitHub App with webhook handling
- Containerized execution environment for isolated job processing
- AI-powered code fixes using LLM (Large Language Models)
- Automated branch management and PR creation

## Technical Summary

The core of the system is built around several key components:

- **GitHub App Server**: Utilizes Bun HTTP server for receiving webhook events and managing authentication and request validation.
- **Queue System**: Jobs are handled through an in-memory FIFO queue with disk persistence for continuity.
- **Docker Orchestration**: Runs user-defined scripts in isolated containers with prebuilt images for supported runtimes.
- **LLM Integration**: Employs OpenAI's API for intelligent code analysis and modification.
- **Git Operations**: Automates repository interactions, including cloning, branch creation, and pull request handling.

## MVP and Planned Enhancements

### Minimal Viable Product (MVP) Features

1. GitHub App installation and permissions
2. Webhook event handling for repository and pull request events
3. Job queuing system with sequential execution
4. Docker container execution for script isolation
5. OpenAI powered code modifications
6. Automated pull request creation

### Future Enhancements

1. Support for additional runtimes (e.g., Python, Go).
2. Advanced LLM-based code understanding and fixes.
3. Web dashboard for monitoring job status and history.
4. Embedding and vector DB for enhanced context retrieval.
5. Monetization strategies including freemium and premium models.

## Setup Guide

To set up the RepoSister Bot, follow these steps:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/RepoSister.git
   cd RepoSister
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Environment Configuration**:
   - Copy `env.example` to `.env` and populate it with your credentials:
     ```
     GITHUB_APP_ID=your_github_app_id
     GITHUB_PRIVATE_KEY=your_private_key
     GITHUB_WEBHOOK_SECRET=your_webhook_secret
     OPENAI_API_KEY=your_openai_api_key
     ```

4. **Start the development server**:
   ```bash
   bun run dev
   ```

5. **Run the CLI** for interactions:
   ```bash
   bun run cli
   ```

## Future Roadmap

- **Q2 2024**: Introduce support for additional programming languages and runtime environments.
- **Q3 2024**: Develop a user interface for monitoring and managing jobs and bot activities.
- **Q4 2024**: Deploy advanced AI models to enhance the scope of automatic code fixes and optimizations.
- **2025**+: Explore integration with other DevOps tools and platforms for broader automation solutions.

## License

Business Source License 1.1 (BSL 1.1)