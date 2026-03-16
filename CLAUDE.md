# Preel

Automated video reviews for GitHub pull requests.

## Architecture

- **Server**: Express.js webhook receiver (`src/server.ts`)
- **GitHub**: App auth, diff fetching, PR commenting (`src/github/`)
- **Analysis**: Claude API for diff review + narration scripting (`src/analyze/`)
- **TTS**: OpenAI gpt-4o-mini-tts narration (`src/tts/narrate.ts`)
- **Render**: Remotion v4 video compositions (`src/render/`)
- **Storage**: Cloudflare R2 for video hosting (`src/storage.ts`)

## Pipeline flow

Webhook → fetch diff → Claude analysis → narration script → TTS + syntax highlighting → Remotion render → R2 upload → PR comment

## Containerized

All rendering runs inside Docker (Chromium + ffmpeg are in the image). The Remotion bundle is pre-built at Docker image build time (`/app/build`). On startup the server detects the pre-built bundle and skips re-bundling.

## Commands

- `npm run typecheck` — TypeScript check
- `npm run dev` — Remotion Studio (local, needs Chromium on host)
- `npm run docker:build` — Build Docker image
- `npm run docker:server` — Start webhook server in Docker
- `npm run docker:preview` — Render preview video with default props
- `npm run docker:review` — Review a PR: `docker compose run --rm review owner/repo 42`

## Key patterns

- Remotion bundle is pre-built in Docker, cached as singleton at runtime
- Shiki highlighter is pre-initialized and cached
- TTS scenes are generated in parallel via Promise.allSettled
- Webhook returns 200 immediately; pipeline runs async (fire-and-forget)
- Bot finds and updates its existing comment on re-pushes (via `<!-- preel-video-review -->` marker)
- `REMOTION_CHROME_EXECUTABLE` env var points Remotion to system Chromium in container
- SELinux: Docker volumes use `:z` flag in docker-compose.yml

## Video specs

- 1920x1080 (16:9), 30fps, H.264/MP4
- Dark theme (GitHub dark palette)
- Target duration: 30-90 seconds
- Scenes: TitleCard → FileOverview → DiffWalkthrough(s) → RiskCallout → Summary

## Composition structure

- `Root.tsx` — Registers PRReview composition with calculateMetadata for dynamic duration
- `PRReview.tsx` — Dispatcher using Remotion Sequences
- Scenes in `scenes/` — TitleCard, FileOverview, DiffWalkthrough, RiskCallout, Summary
- `styles.ts` — Shared colors, fonts, animation utilities

## Environment

See `.env.example` for required variables. Needs:
- GitHub App credentials (APP_ID, PRIVATE_KEY, WEBHOOK_SECRET)
- Anthropic API key
- OpenAI API key (for TTS)
- R2 credentials (optional, falls back to local)
