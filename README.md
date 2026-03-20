# Pull Reviews - AI Powered Video Review

Automated video reviews for GitHub pull requests. Preel analyzes your PR diffs with AI, generates narrated walkthrough scripts, renders short videos with syntax-highlighted code, and posts them back as PR comments.

## How it works

```
Webhook → Fetch diff → AI analysis → Narration script → TTS → Syntax highlighting → Video render → Upload → PR comment
```

1. A GitHub webhook fires when a PR is opened or updated
2. Preel fetches the diff and resolves configuration (presets, auto-detection, per-PR overrides)
3. An LLM (OpenAI or Anthropic) analyzes the diff for purpose, risks, and significance
4. A narration script is generated with time-budgeted scenes
5. OpenAI TTS generates MP3 audio for each scene in parallel
6. Shiki syntax-highlights the diff hunks with green/red line coloring
7. Remotion renders a 1920x1080 H.264 video at 30fps
8. The video uploads to Cloudflare R2
9. A comment with the video and review summary is posted (or updated) on the PR

## Video scenes

| Scene | Description |
|-------|-------------|
| **Title Card** | PR title, author, repo, branch badges, +/- stats |
| **File Overview** | Animated file tree with language icons and change bars |
| **Diff Walkthrough** | Per-file syntax-highlighted code with narration |
| **Risk Callout** | Severity-colored risk items (critical/warning/info) |
| **Summary** | Sentiment badge, review summary, quick stats |

All scenes are individually toggleable via configuration.

## Quick start

### Prerequisites

- Docker (rendering requires Chromium + ffmpeg)
- GitHub personal access token (for CLI) or GitHub App credentials (for webhook)
- OpenAI API key (for LLM analysis and TTS)

### CLI usage (test against a real PR)

```bash
cp .env.example .env
# Fill in GITHUB_TOKEN and OPENAI_API_KEY

# Build the Docker image
npm run docker:build

# Review a PR
docker compose run --rm review owner/repo 42
docker compose run --rm review owner/repo 42 --preset=security
```

### Webhook server

```bash
# Fill in all GitHub App credentials in .env
npm run docker:build
npm run docker:server
```

The server listens on port 3001 and processes `pull_request` events (opened/synchronize).

### Local development (Remotion Studio)

```bash
npm install
npm run dev
```

Opens Remotion Studio for previewing compositions with default props. Requires Chromium on the host.

## Configuration

Preel is deeply configurable through multiple layers:

1. **Environment variables** — base settings
2. **`.preel.yml`** in your repo — per-repo defaults
3. **Built-in presets** — `quick`, `thorough`, `security`, `architecture`, `onboarding`
4. **Auto-detection** — from branch names, commit prefixes, file patterns, labels
5. **PR body overrides** — `<!-- preel ... -->` YAML blocks

See [docs/configuration.md](docs/configuration.md) for the full reference.

## Documentation

| Document | Description |
|----------|-------------|
| [Configuration](docs/configuration.md) | Full config reference — presets, YAML, env vars, auto-detection |
| [Architecture](docs/architecture.md) | System design, pipeline flow, data model |
| [Deployment](docs/deployment.md) | Docker setup, GitHub App, R2 storage, production checklist |
| [Scenes & Video](docs/scenes.md) | Video composition structure, scene details, styling |
| [CLI Reference](docs/cli.md) | Local testing commands and options |
| [LLM Analysis](docs/analysis.md) | How AI review works — prompts, providers, output format |

## Environment variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Powers LLM analysis and TTS |
| `GITHUB_TOKEN` | CLI only | Personal access token for CLI testing |
| `GITHUB_APP_ID` | Server | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | Server | GitHub App private key (PEM or base64) |
| `GITHUB_WEBHOOK_SECRET` | Server | Webhook signature verification |
| `LLM_PROVIDER` | No | `openai` (default) or `anthropic` |
| `R2_BUCKET` | No | Cloudflare R2 bucket (falls back to local) |

## Scripts

```bash
npm run typecheck        # TypeScript check
npm run dev              # Remotion Studio (local)
npm run build            # Bundle Remotion project
npm run docker:build     # Build Docker image
npm run docker:server    # Start webhook server in Docker
npm run docker:preview   # Render preview video with default props
npm run docker:review    # Review a PR via CLI in Docker
```

## License

MIT
