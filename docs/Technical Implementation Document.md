# GitHub Bot MVP - Technical Implementation Document

## 1. Core Components

### 1.1 GitHub App Server

**Technology**: Bun HTTP Server

- Webhook handler endpoints for GitHub events
- GitHub App authentication using JWT
- Request validation with webhook secrets

**GitHub App Authentication Flow**:

- Generate a private key in GitHub App settings
- Use private key to sign JWT for GitHub API authentication
- For each installation, obtain an installation token
- Use installation token for repository-specific operations

**Implementation Details**:

- Create GitHub App with required permissions:
  - Repository contents: read/write
  - Issues: read/write
  - Pull requests: read/write
  - Metadata: read-only
- Subscribe to webhook events:
  - `issue_comment`
  - `pull_request`
  - `push`
- Store the GitHub App ID, private key, and webhook secret as environment variables

### 1.2 Queue System

**Technology**: In-memory FIFO queue with persistence

- Job structure with status tracking
- Periodic persistence to disk
- Error handling and retry mechanism

**Implementation Details**:

- Queue data structure:
  ```typescript
  interface Job {
    id: string;
    repositoryUrl: string;
    installationId: number;
    eventType: string;
    payload: any;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdAt: Date;
    updatedAt: Date;
    attempts: number;
    logs: string[];
  }
  ```
- Queue persistence:
  - Save queue state to disk every 5 minutes
  - Load from disk on startup
  - Use JSON file storage for simplicity

### 1.3 Docker Orchestration

**Technology**: Dockerode with Docker socket

- Pre-built images for Bun runtime
- Isolated execution environment for each job
- Resource limits and security constraints

**Implementation Details**:

- Container configuration:
  ```typescript
  {
    Image: 'reposister/bun:latest',
    Cmd: ['sh', '-c', 'cd /workspace && bun install && bun run lint'],
    HostConfig: {
      Binds: [`${localRepoPath}:/workspace:ro`],
      Memory: 1024 * 1024 * 1024, // 1GB
      MemorySwap: 1024 * 1024 * 1024, // 1GB
      NetworkMode: 'none',
      AutoRemove: true,
    }
  }
  ```
- Output capture via container logs
- Timeout mechanism (10 minutes per job)

### 1.4 LLM Integration

**Technology**: OpenAI Node.js SDK

- GPT-4 for code understanding and modifications
- Systematic prompt templates for different tasks
- Context window management

**Implementation Details**:

- API client configuration:
  ```typescript
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  ```
- Basic prompt template for code fixes:

  ```typescript
  const generateFixPrompt = (code: string, issue: string) => `
  You are a professional developer fixing the following issue:
  ${issue}
  
  Here is the code that needs fixing:
  \`\`\`
  ${code}
  \`\`\`
  
  Please provide only the corrected code with no explanations.
  `;
  ```

- Rate limiting and error handling mechanisms

### 1.5 Git Operations

**Technology**: simple-git

- Repository cloning
- Branch creation
- Commit and push changes
- PR creation via GitHub API

**Implementation Details**:

- Clone repository:
  ```typescript
  await git.clone(repoUrl, localPath, ['--depth=1']);
  ```
- Create branch and commit changes:
  ```typescript
  await git.checkoutLocalBranch(`fix/${issueId}`);
  await git.add('.');
  await git.commit('Fix: Automated fix by GitHub Bot');
  await git.push('origin', `fix/${issueId}`);
  ```
- Create PR via GitHub API:
  ```typescript
  await octokit.pulls.create({
    owner,
    repo,
    title: 'Automated fix by GitHub Bot',
    head: `fix/${issueId}`,
    base: 'main',
    body: '...',
  });
  ```

## 2. Configuration & Environment

### 2.1 Environment Variables

**Development**: `.env` file (gitignored)
**Production**: Coolify secrets management

```
# GitHub App
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=

# OpenAI
OPENAI_API_KEY=

# Application
PORT=3000
BUN_ENV=production
LOG_LEVEL=info
MAX_CONCURRENT_JOBS=2
```

### 2.2 Bot Configuration File

`.reposister.yml` in user repositories:

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

## 3. Deployment

### 3.1 Docker Compose Setup

```yaml
version: '3'
services:
  app:
    build: .
    restart: always
    environment:
      - BUN_ENV=production
      - PORT=3000
      # Other env vars provided by Coolify
    ports:
      - '3000:3000'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - repos:/app/repos
      - queue-data:/app/data

volumes:
  repos:
  queue-data:
```

### 3.2 Dockerfile

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package*.json ./
RUN bun install --production

COPY . .
RUN bun run build

# Install Docker CLI
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

EXPOSE 3000
CMD ["bun", "dist/app.js"]
```

### 3.3 Runtime Containers

Pre-built images for supported runtimes:

- `reposister/bun:latest` - Latest Bun version with common dev tools

## 4. Implementation Flow

### 4.1 Project Initialization

1. Set up TypeScript project with Bun
2. Configure GitHub App (permissions, webhook endpoints)
3. Implement webhook receiver and authentication

### 4.2 Core Job Processing

1. Build in-memory queue system with persistence
2. Implement job worker that processes queue items
3. Create Docker orchestration for running scripts

### 4.3 Git Operations

1. Implement repository cloning
2. Add branch and commit functionality
3. Create PR opening mechanism

### 4.4 LLM Integration

1. Set up OpenAI client
2. Create prompt templates for different use cases
3. Implement code modification logic

### 4.5 Container Execution

1. Build runtime container images
2. Implement execution of user scripts in containers
3. Add result handling and logging

### 4.6 Error Handling & Resilience

1. Implement proper error handling throughout the system
2. Add retry mechanisms for transient failures
3. Create a robust logging system with Pino.js

## 5. Project Structure

```
/
├── src/
│   ├── app.ts                  # Entry point Bun
│   ├── config/                 # Configurations
│   │   ├── app.ts              # App configuration
│   │   ├── env.ts              # Environment variables
│   │   └── logger.ts           # Logging configuration
│   ├── github/                 # GitHub App logic
│   │   ├── app.ts              # App authentication
│   │   ├── api.ts              # GitHub API client
│   │   └── webhooks/           # Webhook handlers
│   │       ├── index.ts        # Webhook router
│   │       ├── issue-comment.ts  # Issue comment handler
│   │       └── pull-request.ts # PR handler
│   ├── queue/                  # Queue system
│   │   ├── index.ts            # Queue implementation
│   │   ├── job.ts              # Job structure
│   │   ├── persistence.ts      # Queue persistence
│   │   └── worker.ts           # Job processor
│   ├── docker/                 # Docker orchestration
│   │   ├── index.ts            # Docker client
│   │   ├── executor.ts         # Script executor
│   │   └── output.ts           # Output capture
│   ├── llm/                    # LLM integration
│   │   ├── client.ts           # OpenAI client
│   │   ├── prompts/            # Prompt templates
│   │   │   ├── fix.ts          # Fix prompts
│   │   │   └── analyze.ts      # Analysis prompts
│   │   └── processor.ts        # Code processor
│   ├── git/                    # Git operations
│   │   ├── clone.ts            # Repository cloning
│   │   ├── commit.ts           # Commit changes
│   │   └── pr.ts               # PR creation
│   ├── utils/                  # Shared utilities
│   │   ├── fs.ts               # File system utils
│   │   ├── yaml.ts             # YAML parser
│   │   └── error.ts            # Error handling
│   └── types/                  # Type definitions
│       ├── github.ts           # GitHub types
│       ├── job.ts              # Job types
│       └── config.ts           # Config types
├── test/                       # Test suite
├── docker/                     # Docker files
│   ├── Dockerfile              # Main app
│   └── runtimes/               # Runtime images
│       ├── node18/             # Node.js 18 image
│       └── node20/             # Node.js 20 image
├── docker-compose.yml          # Docker Compose
├── .env.example                # Environment template
├── tsconfig.json               # TypeScript config
└── package.json                # Dependencies
```

## 6. Next Steps

1. Set up basic project structure and dependencies
2. Implement GitHub App authentication
3. Create webhook handling endpoints
4. Build in-memory queue system
5. Develop Docker orchestration logic
6. Implement Git operations with simple-git
7. Set up OpenAI integration
8. Create Docker Compose deployment configuration
9. Test end-to-end job processing flow
10. Deploy to Coolify self-hosted environment
