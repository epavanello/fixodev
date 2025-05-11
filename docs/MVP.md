# GitHub Bot MVP - Technical Specification & Strategic Plan

## 1. Overview

This project aims to build an MVP of a GitHub App-based bot that:

- Receives GitHub webhook events (e.g. issue comment or PR opened)
- Clones a repository in a sandboxed environment
- Runs user-defined scripts (e.g. lint, format, test)
- Applies AI-assisted code modifications via LLM
- Pushes changes and opens a Pull Request automatically

The service is designed to be fully automated, secure, and containerized, with future support for advanced indexing and code understanding using embeddings.

---

## 2. MVP Scope (Feature Set)

### Core Functionality

- [ ] GitHub App: Installable on public and private repositories
- [ ] Webhook handler: Triggered via GitHub events
- [ ] Queue system: Sequential job execution with status tracking
- [ ] Codebase clone: Shallow clone with `--depth=1`
- [ ] `.bot-config.yml`: Optional per-repo file to declare runtime + scripts
- [ ] Docker execution:

  - Prebuilt Docker images for each supported runtime
  - Run lint/format/test scripts inside isolated container

- [ ] Git operations:

  - Create new branch
  - Commit changes
  - Open Pull Request

### Initial Supported Runtimes

- `node:18`
- `node:20`
- (Optional in future: python, go, java, ruby, php, rust)

---

## 3. Infrastructure Architecture

### Core Components (All written in TypeScript)

- GitHub App server
- Job queue (in-memory FIFO or BullMQ/Redis)
- Docker orchestrator (using `dockerode`)
- LLM client (e.g. OpenAI API or open-source model)
- Embedding + vector DB (Qdrant or similar)

### Container Strategy

- The bot itself runs in a container
- It mounts `/var/run/docker.sock` to spawn job containers
- Each job container is isolated:

  - `--rm` auto-cleanup
  - `--network=none` for security
  - Mounted code at `/workspace`
  - Resource limits (memory, CPU)

### Embedding Layer (for future iterations)

- Chunk code files (\~200 tokens per chunk)
- Generate embedding vectors (e.g. OpenAI `text-embedding-ada-002`)
- Store in vector DB for context retrieval during LLM queries
- Cache unchanged files to avoid redundant embedding costs

---

## 4. Implementation Time Estimate (Solo Senior Dev)

| Task                          | Est. Time     |
| ----------------------------- | ------------- |
| GitHub App Setup              | 4–6 hrs       |
| Webhook & Token Auth          | 2–3 hrs       |
| Repo Cloning + Config Parsing | 3–4 hrs       |
| Queue System (sequential)     | 3–4 hrs       |
| Docker Orchestration          | 4–6 hrs       |
| Script Execution & Logging    | 3–4 hrs       |
| Commit & PR Creation          | 2–3 hrs       |
| Cleanup & Error Handling      | 4–5 hrs       |
| Testing (e2e) & Fixes         | 6–8 hrs       |
| **Total Estimate**            | **30–40 hrs** |

With Cursor/Copilot: \~20–28 hrs
With AI-only assistance (prompting): \~40–60 hrs

---

## 5. Monetization Strategies

### Freemium Model

- Free for public repos, limited PRs/month (e.g. 5)
- Paid plans unlock:

  - Unlimited public PRs
  - Private repo support
  - Priority execution queue
  - Team control and analytics

### Value-Add Premium Features

- `.bot-config.yml` overrides
- LLM model selection (Claude, GPT-4, etc.)
- Advanced fix categories (refactor, CI fixes)
- Multi-repo batch fixes

### BYOK (Bring Your Own Key)

- Users can provide their own OpenAI API key to reduce costs

---

## 6. Growth & Advertising Tactics

### "Inbound PR Marketing"

- Monitor public issues tagged with `#ai-fix`, `help-wanted`, etc.
- Clone repos, apply automated fixes, open PRs
- Add signature: "Suggested by @yourbot – [Install the app](https://...)"
- Operates legally under open-source licenses

### Incentivized Installation

- Without install: only surprise/frequent PRs
- With install:

  - Trigger bot manually (via `/fix`, `/lint`)
  - Customize scripts and runtime
  - Use on private repos
  - View fix history, logs, stats

### Community Engagement

- Leaderboard for contributors using the bot
- "Bot-powered repo" badge for opt-in users
- Invite to early feature access for maintainers

---

## 7. Future Enhancements

- Embedding cache with vector search
- Custom prompt templates
- LLM fallback chains (retry with different model)
- Web dashboard with job history and stats
- Concurrency / distributed job processing
- Integration with GitHub Actions

---
