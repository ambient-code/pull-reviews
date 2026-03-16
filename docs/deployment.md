# Deployment

## Docker

All rendering runs inside Docker. The container includes Chromium and ffmpeg for headless video rendering.

### Building

```bash
npm run docker:build
# or
docker build -t preel .
```

The Docker build:

1. Installs system dependencies (Chromium, ffmpeg, font libraries)
2. Runs `npm ci` for Node.js dependencies
3. **Pre-bundles the Remotion project** — this avoids bundling at runtime and significantly speeds up the first review
4. Creates the output directory

The pre-built bundle is stored at `/app/build` in the image. At runtime, `ensureBundle()` detects it and skips re-bundling.

### Running the webhook server

```bash
npm run docker:server
# or
docker compose up preel
```

The server starts on port 3001 (configurable via `PORT` env var).

### One-off CLI review

```bash
docker compose run --rm review owner/repo 42
docker compose run --rm review owner/repo 42 --preset=security
```

### Preview with default props

```bash
npm run docker:preview
# or
docker compose run --rm preview
```

Renders a sample video using the default props defined in `Root.tsx`.

### Docker Compose services

| Service | Purpose | Profile |
|---------|---------|---------|
| `preel` | Webhook server (long-running) | default |
| `preview` | Render preview video | tools |
| `review` | CLI review of a real PR | tools |

All services mount `./out:/app/out:z` for video output. The `:z` flag is for SELinux compatibility.

---

## GitHub App setup

Preel runs as a GitHub App to receive webhooks and post comments on PRs.

### Create the app

1. Go to your organization settings → Developer settings → GitHub Apps → New GitHub App
2. Configure:
   - **Name:** Preel (or your preferred name)
   - **Homepage URL:** Your deployment URL
   - **Webhook URL:** `https://your-server:3001/webhook`
   - **Webhook secret:** Generate a strong secret
3. Permissions:
   - **Pull requests:** Read & Write (to post comments)
   - **Contents:** Read (to fetch `.preel.yml` config files)
4. Subscribe to events:
   - **Pull request**
5. Generate a private key (download the `.pem` file)

### Required credentials

| Variable | Where to find it |
|----------|-----------------|
| `GITHUB_APP_ID` | App settings page, "App ID" field |
| `GITHUB_PRIVATE_KEY` | Downloaded `.pem` file contents (or base64-encoded) |
| `GITHUB_WEBHOOK_SECRET` | The secret you set during app creation |

The private key can be provided as:
- Raw PEM content (with `-----BEGIN RSA PRIVATE KEY-----` header)
- Base64-encoded PEM (auto-detected and decoded)

### Install the app

After creating the app, install it on the repositories you want to review:

1. Go to the app's page → Install App
2. Choose the organization or user account
3. Select "All repositories" or specific repos

---

## Cloudflare R2 storage

Preel uploads rendered videos to Cloudflare R2 (S3-compatible object storage).

### Setup

1. Create an R2 bucket in your Cloudflare dashboard
2. Create an API token with R2 read/write permissions
3. (Optional) Configure a custom domain or public bucket URL for CDN access

### Required credentials

| Variable | Description |
|----------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret key |
| `R2_BUCKET` | Bucket name |
| `CDN_BASE_URL` | (Optional) Public URL prefix for videos |

Videos are uploaded to `videos/{jobId}.mp4` in the bucket.

If `CDN_BASE_URL` is set, the video URL in PR comments will be `{CDN_BASE_URL}/videos/{jobId}.mp4`. Otherwise, the object key is returned.

### Without R2

If R2 credentials are not configured, videos are kept at the local output path. This is fine for CLI testing but not useful for the webhook server (the PR comment won't have a working video URL).

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### Required (always)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for LLM analysis and TTS |

### Required (webhook server)

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | GitHub App private key |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature secret |

### Required (CLI only)

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | Personal access token (needs `repo` scope for private repos, `public_repo` for public) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | LLM provider: `openai` or `anthropic` |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model for analysis |
| `ANTHROPIC_API_KEY` | — | Required if `LLM_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Anthropic model for analysis |
| `PORT` | `3001` | Server port |
| `OUTPUT_DIR` | `./out` | Local output directory for videos |
| `RENDER_CONCURRENCY` | `4` | Remotion render thread count |
| `REMOTION_CHROME_EXECUTABLE` | — | Path to Chromium (auto-detected in Docker) |
| `SKIP_TTS` | — | Set to `1` to skip TTS (silent video) |
| `R2_ACCOUNT_ID` | — | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | — | R2 access key |
| `R2_SECRET_ACCESS_KEY` | — | R2 secret key |
| `R2_BUCKET` | — | R2 bucket name |
| `CDN_BASE_URL` | — | Public URL prefix for videos |

---

## Production checklist

- [ ] Docker image built with `npm run docker:build`
- [ ] GitHub App created with correct permissions and webhook URL
- [ ] GitHub App installed on target repos
- [ ] `.env` populated with all required credentials
- [ ] R2 bucket created and credentials configured
- [ ] Webhook URL publicly accessible (or use a tunnel for testing)
- [ ] Server running: `docker compose up -d preel`
- [ ] Test with a PR: open or update a PR on an installed repo
- [ ] Verify: check server logs, PR comment appears with video

### Health check

```bash
curl http://localhost:3001/health
# → {"status":"ok"}
```

### Monitoring

The server logs each review's progress:

```
=== Starting review: owner-repo-42-abc1234 ===
Fetching PR diff...
Config: preset=security, source=label
After filtering: 12 files
Analyzing...
Script: 5 scenes, ~45s
Generating TTS and highlighting...
TTS: title → 4.2s (48320 bytes)
TTS: diff-0 → 8.1s (92160 bytes)
...
Rendering video...
Render: 20%
Render: 40%
...
Video rendered: /app/out/owner-repo-42-abc1234.mp4
=== Review complete: owner-repo-42-abc1234 (38.2s) ===
```
