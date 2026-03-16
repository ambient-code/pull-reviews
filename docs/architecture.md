# Architecture

## System overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  GitHub PR   │────▶│  Webhook     │────▶│  Pipeline   │
│  Event       │     │  Server      │     │  Processor  │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
              ┌─────▼─────┐            ┌────────▼────────┐          ┌──────▼──────┐
              │  Config    │            │  AI Analysis    │          │  GitHub     │
              │  Resolver  │            │  (OpenAI/Claude)│          │  Diff Fetch │
              └─────┬─────┘            └────────┬────────┘          └─────────────┘
                    │                           │
                    │                    ┌──────▼──────┐
                    │                    │   Script    │
                    │                    │   Generator │
                    │                    └──────┬──────┘
                    │                           │
                    │              ┌────────────┼────────────┐
                    │              │                         │
                    │        ┌─────▼─────┐           ┌──────▼──────┐
                    │        │   TTS     │           │   Shiki     │
                    │        │  (OpenAI) │           │  Highlight  │
                    │        └─────┬─────┘           └──────┬──────┘
                    │              │                         │
                    │              └────────────┬────────────┘
                    │                           │
                    │                    ┌──────▼──────┐
                    │                    │  Remotion   │
                    └───────────────────▶│  Renderer   │
                                         └──────┬──────┘
                                                │
                                    ┌───────────┼───────────┐
                                    │                       │
                              ┌─────▼─────┐          ┌─────▼─────┐
                              │  R2       │          │  PR       │
                              │  Upload   │          │  Comment  │
                              └───────────┘          └───────────┘
```

## Directory structure

```
src/
├── index.tsx              # Remotion entry point (registerRoot)
├── server.ts              # Express webhook server
├── cli.ts                 # CLI for local testing
├── config.ts              # Environment variable loading
├── types.ts               # Core TypeScript types + Zod schemas
├── storage.ts             # Cloudflare R2 upload
├── config/                # Configuration system
│   ├── schema.ts          # Zod schemas, resolved types, defaults
│   ├── presets.ts         # Built-in preset definitions
│   ├── merge.ts           # Deep merge + overlay utilities
│   ├── detect.ts          # Auto-detection (branch, commit, files, labels)
│   ├── parse-pr.ts        # PR body <!-- preel --> block parser
│   ├── resolve.ts         # Full resolution pipeline
│   └── index.ts           # Barrel exports
├── github/                # GitHub integration
│   ├── app.ts             # GitHub App authentication
│   ├── webhooks.ts        # Webhook handler + signature verification
│   ├── diff.ts            # PR diff fetching + parsing
│   └── comment.ts         # PR comment posting/updating
├── analyze/               # AI analysis
│   ├── reviewer.ts        # LLM-powered diff review
│   └── script.ts          # Narration script generator
├── tts/                   # Text-to-speech
│   └── narrate.ts         # OpenAI TTS generation
└── render/                # Video rendering
    ├── pipeline.ts        # Main pipeline orchestrator
    └── compositions/      # Remotion components
        ├── Root.tsx        # Composition registration + metadata
        ├── PRReview.tsx    # Main scene dispatcher
        ├── styles.ts      # Theme, fonts, animation utilities
        └── scenes/        # Individual scene components
            ├── TitleCard.tsx
            ├── FileOverview.tsx
            ├── DiffWalkthrough.tsx
            ├── RiskCallout.tsx
            └── Summary.tsx
```

## Pipeline flow

### 1. Webhook reception (`server.ts` → `webhooks.ts`)

The Express server receives GitHub webhook POST requests at `/webhook`. The handler:

- Verifies the HMAC-SHA256 signature against `GITHUB_WEBHOOK_SECRET`
- Responds `200` immediately (fire-and-forget pattern)
- Filters for `pull_request` events with action `opened` or `synchronize`
- Extracts `PRContext` from the payload (owner, repo, PR number, author, branches, labels, body)
- Calls `processReview()` asynchronously — errors are logged but don't crash the server

### 2. Config resolution (`config/resolve.ts`)

The resolver builds a fully-populated `ResolvedPreelConfig` by layering sources:

```
DEFAULT_CONFIG
  ← env var overrides
  ← PREEL_PRESET env
  ← .preel.yml (fetched from repo)
  ← auto-detection (branch/commit/files/labels)
  ← PR body overrides
  ← size gates
```

Can return `action: "skip"` if the PR should be skipped (label, opt-in mode, size gate).

### 3. Diff fetching (`github/diff.ts`)

Calls `octokit.pulls.listFiles()` to get per-file patches. Each file is parsed into:

- `FileDiff` with filename, status, additions/deletions, language
- `DiffHunk[]` with parsed lines (add/remove/context) and line numbers
- Language detected from file extension (30+ mappings)

Ignore patterns (from config) are applied via picomatch.

### 4. AI analysis (`analyze/reviewer.ts`)

Sends the diff to an LLM (OpenAI gpt-4o or Anthropic Claude) with a dynamically-constructed system prompt:

- Base instructions with JSON schema requirement
- Verbosity level instructions
- Focus area priorities (sorted by priority)
- Areas to ignore
- Custom instructions from config

Returns `PRReviewData`: per-file reviews with purpose/narration/significance, risk items, stats, overall sentiment, and summary.

### 5. Script generation (`analyze/script.ts`)

Converts the review into a `NarrationScript` with timed scenes:

- Duration budget from `config.video.duration.max`
- Scenes enabled/disabled from `config.scenes`
- Files filtered by significance and sorted (high first)
- Time allocation: reserves time for risk + summary, allocates remainder to diffs
- Each scene capped at 12 seconds

### 6. TTS + highlighting (parallel)

**TTS** (`tts/narrate.ts`): Generates MP3 audio for each scene using OpenAI gpt-4o-mini-tts. All scenes processed in parallel via `Promise.allSettled`. Actual audio duration extracted from MP3 metadata.

**Highlighting** (`render/pipeline.ts`): Shiki syntax-highlights the first 3 hunks (20 lines each) of each file. Adds inline CSS for diff coloring (green additions, red deletions with opacity).

### 7. Video rendering

Remotion renders the video with:

- Bundle: pre-built at Docker build time (`/app/build`), cached as singleton
- Composition: `PRReview` with dynamic duration from `calculateMetadata`
- Audio: TTS MP3 files copied into bundle's `public/` dir, served via `staticFile()`
- Codec: H.264, 1920x1080, 30fps
- Chromium: system binary (`REMOTION_CHROME_EXECUTABLE`)

### 8. Upload + comment

- Video uploaded to Cloudflare R2 (or kept local if R2 not configured)
- PR comment posted/updated with video embed, summary, risks, and file breakdown
- Bot finds its own existing comment via `<!-- preel-video-review -->` marker

---

## Data model

### Core types

```typescript
// Diff representation
FileDiff { filename, status, additions, deletions, language, hunks[], oldFilename? }
DiffHunk { header, lines[] }
DiffLine { type: "add"|"remove"|"context", content, oldLineNumber?, newLineNumber? }

// AI review output
PRReviewData { summary, overallSentiment, fileReviews[], risks[], stats }
FileReview { filename, purpose, narration, significance, keyChanges[] }
RiskItem { severity, category, description, filename? }
PRStats { totalAdditions, totalDeletions, filesChanged, languages[] }

// Narration
NarrationScript { scenes[], totalEstimatedSeconds }
SceneScript { sceneId, narrationText, estimatedSeconds }

// TTS output
TTSResult { audioFiles: Record<sceneId, filePath>, audioDurations: Record<sceneId, seconds> }

// Remotion input
PRReviewProps { ...prMetadata, stats, fileReviews[], risks[], audioDurations, audioFiles?, show* toggles }

// Webhook context
PRContext { installationId, owner, repo, prNumber, prTitle, author*, branches, headSha, labels?, body? }
```

### Config types

```typescript
ResolvedPreelConfig {
  review: { verbosity, max_files_analyzed, focus: Record<area, priority>, custom_instructions }
  scenes: { title_card, file_overview, diff_walkthrough: { enabled, max_files, skip_significance }, risk_callout, summary }
  tts: { voice, speed, tone }
  video: { duration: { min, max }, show_stats, show_branch_info }
  filter: { ignore[], min_files, max_files, min_changes, max_changes, max_exceeded_action }
  auto_detect: { conventional_commits, labels, file_patterns[], branch_patterns[] }
  labels: { opt_in, skip[] }
}
```

---

## Key design patterns

### Singleton caching

The Remotion bundle and Shiki highlighter are expensive to initialize. Both are cached at module level and reused across all reviews:

```typescript
let bundleLocation: string | null = null;
let highlighter: Highlighter | null = null;
```

### Fire-and-forget webhook

The webhook handler responds `200` immediately and processes the review asynchronously. This prevents GitHub webhook timeouts (10 second limit) and allows long-running renders.

### Comment idempotency

On re-pushes, Preel finds and updates its existing PR comment rather than creating a new one. It uses an HTML comment marker (`<!-- preel-video-review -->`) to identify its own comments.

### Audio-driven timing

Video scene durations are calculated from actual TTS audio lengths (extracted via `music-metadata`), not from text estimates. Scenes are padded with a small buffer and clamped to min/max bounds.

### Budget-aware scene selection

The script generator allocates a time budget from the max duration config. It reserves time for risk callout and summary, then fills remaining time with diff walkthrough scenes sorted by significance.

### Graceful degradation

- R2 not configured → video stays local (path returned instead of URL)
- TTS fails for a scene → uses estimated duration, scene has no audio
- Syntax highlighting fails → plain text fallback with HTML escaping
- Unsupported language → falls back to `text` or `javascript` highlighting
