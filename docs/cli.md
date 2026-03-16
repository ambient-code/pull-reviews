# CLI Reference

The CLI lets you test Preel locally against real GitHub PRs without running the webhook server.

## Usage

```bash
npx tsx src/cli.ts <owner/repo> <pr-number> [--preset=<name>]
```

### Docker (recommended)

```bash
# Build the image first
npm run docker:build

# Review a PR
docker compose run --rm review owner/repo 42
docker compose run --rm review owner/repo 42 --preset=security
docker compose run --rm review owner/repo 42 --preset=quick
```

### Local (requires Chromium on host)

```bash
npx tsx src/cli.ts octocat/hello-world 42
npx tsx src/cli.ts octocat/hello-world 42 --preset=thorough
```

## Required environment

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | Personal access token with `repo` scope |
| `OPENAI_API_KEY` | OpenAI API key for analysis and TTS |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `SKIP_TTS` | — | Set to `1` to skip TTS (produces silent video, faster) |
| `LLM_PROVIDER` | `openai` | `openai` or `anthropic` |
| `PREEL_PRESET` | — | Force a preset via env var |
| `OUTPUT_DIR` | `./out` | Where to save the video |

## What it does

1. Fetches the PR metadata and diff from GitHub
2. Resolves configuration (env vars + `PREEL_PRESET` + `--preset` flag)
3. Analyzes the diff with the configured LLM
4. Generates a narration script
5. Generates TTS audio (unless `SKIP_TTS=1`)
6. Syntax-highlights the diff hunks
7. Renders the video
8. Saves to `{OUTPUT_DIR}/cli-{owner}-{repo}-{prNumber}.mp4`
9. Prints a review summary

## What it does NOT do

- Post a comment on the PR
- Upload the video to R2
- Fetch `.preel.yml` from the repo (uses local config only)
- Auto-detect presets from labels/branch/files

## Presets

Available presets: `default`, `quick`, `thorough`, `security`, `architecture`, `onboarding`

The `--preset` flag takes priority over the `PREEL_PRESET` env var.

## Output

```
Fetching PR #42 from acme/webapp...
Fetching diff...
12 files (after filtering)
Using preset: security
Analyzing...
Script: 5 scenes, ~42s
Generating TTS...
TTS: title → 4.2s (48320 bytes)
TTS: diff-0 → 8.3s (94208 bytes)
TTS: diff-1 → 7.1s (80896 bytes)
TTS: risk → 5.8s (65536 bytes)
TTS: summary → 4.9s (55296 bytes)
Highlighting diffs...
Rendering video...
Render: 10%
Render: 20%
...
Render: 100%
Video saved: ./out/cli-acme-webapp-42.mp4

--- Review Summary ---
Preset: security
Sentiment: cautious
Files: 8
Risks: 3
Summary: This PR introduces authentication middleware with a few security considerations...
```

## GitHub token permissions

For **public** repos: `public_repo` scope is sufficient.

For **private** repos: `repo` scope (full control of private repositories).

Generate a token at: Settings → Developer settings → Personal access tokens → Tokens (classic)
