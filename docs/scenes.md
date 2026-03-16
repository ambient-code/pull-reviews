# Scenes & Video

## Video specs

| Property | Value |
|----------|-------|
| Resolution | 1920x1080 (16:9) |
| Frame rate | 30 fps |
| Codec | H.264 / MP4 |
| Theme | GitHub dark palette |
| Target duration | 30–90 seconds (configurable) |
| Font (code) | JetBrains Mono |
| Font (text) | Inter |

## Scene order

```
TitleCard → FileOverview → DiffWalkthrough(s) → RiskCallout → Summary
```

Each scene is a Remotion `<Sequence>` with audio attached. Scene durations are driven by actual TTS audio length, with min/max bounds. All scenes except DiffWalkthrough are optional via config toggles.

---

## TitleCard

**Scene ID:** `title`

Displays the PR metadata as an opening card.

**Elements:**
- Repository name (e.g., `acme/webapp`)
- PR number and title
- Author avatar (from GitHub) and login name
- Branch badges: `main` ← `feat/auth-middleware`
- Stats: `+142 −38` with colored indicators, file count

**Animations:**
- Spring entrance for the main card (scale + opacity)
- Slide-in from left for repo name
- Staggered fade-in for branch badges and stats

**Config toggles:**
- `showTitleCard: false` — skips this scene entirely
- `showStats: false` — hides the +/- stats (via config, not yet wired to component)
- `showBranchInfo: false` — hides branch badges (via config, not yet wired to component)

---

## FileOverview

**Scene ID:** `file-overview`

An animated file listing showing all changed files.

**Elements:**
- "Files Changed" header with count badge
- Up to 12 files displayed with:
  - Language color dot (based on file extension)
  - Directory path (dimmed) + filename
  - Green/red bars proportional to additions/deletions
  - Count labels (`+86 −0`)
- High-significance files highlighted with accent left border
- "and X more files..." indicator if truncated

**Animations:**
- Spring entrance for header
- Staggered slide-in for each file row

**Config:** `showFileOverview: false` to skip.

---

## DiffWalkthrough

**Scene ID:** `diff-{index}` (e.g., `diff-0`, `diff-1`, ...)

Per-file code walkthrough with syntax-highlighted diffs and narration.

**Elements:**
- Progress bar at top (file X of Y)
- File header: language badge, filename, +/- counts
- Purpose text (AI-generated one-line description)
- Code viewer:
  - macOS-style window chrome (three dots: red, amber, green)
  - Syntax-highlighted code via Shiki
  - Green background + left border for additions
  - Red background + left border for deletions (with 0.7 opacity)
  - Context lines with neutral padding
- Up to 3 hunks shown, 20 lines per hunk

**Animations:**
- Fade-in for header elements
- Staggered spring entrance for code hunks

**Config:**
- `scenes.diff_walkthrough.enabled: false` — skips all diff scenes
- `scenes.diff_walkthrough.max_files: 8` — max number of diff scenes
- `scenes.diff_walkthrough.skip_significance: ["low"]` — skip files below threshold

**Duration:** 6–12 seconds per file, driven by narration audio length. Total diff time is budget-allocated based on the remaining time after other scenes.

---

## RiskCallout

**Scene ID:** `risk`

Highlights potential risks identified by the AI review.

**Elements:**
- "Heads Up" header with risk count badge
- Up to 6 risk items with:
  - Severity icon: `⊘` (critical), `△` (warning), `ℹ` (info)
  - Severity label in color (red/amber/blue)
  - Category tag
  - Description text

**Animations:**
- Spring entrance for header
- Staggered fade-in for risk items

**Config:** `scenes.risk_callout: false` to skip.

**Note:** This scene is automatically skipped if there are zero risks, regardless of config.

---

## Summary

**Scene ID:** `summary`

Closing scene with overall review assessment.

**Elements:**
- Sentiment badge with icon and color:
  - `positive` — green ✓
  - `neutral` — gray →
  - `cautious` — amber △
  - `critical` — red !
- Summary text (AI-generated paragraph)
- Quick stats footer: additions, deletions, file count, risk count
- "preel" branding

**Animations:**
- Scale-in for sentiment badge
- Spring entrance for summary text
- Fade-out at the end of the scene

**Config:** `showSummary: false` to skip.

---

## Duration calculation

Scene durations are calculated from TTS audio with bounds:

```typescript
getSceneDuration(fps, minSeconds, maxSeconds, audioDuration?)
```

| Scene | Min | Max |
|-------|-----|-----|
| Title | 5s | 8s |
| File Overview | 5s | 8s |
| Diff Walkthrough | 6s | 12s |
| Risk Callout | 5s | 10s |
| Summary | 5s | 8s |

If audio is available, the duration is `audioSeconds * fps + padding`, clamped to [min, max]. Without audio (TTS skipped or failed), the estimated duration from the script generator is used.

The total video duration is clamped to 30–120 seconds (configurable via `video.duration`).

---

## Theme

The video uses GitHub's dark color palette:

| Token | Color | Usage |
|-------|-------|-------|
| `bg` | `#0d1117` | Main background |
| `bgSecondary` | `#161b22` | Card backgrounds |
| `text` | `#e6edf3` | Primary text |
| `textSecondary` | `#8b949e` | Dimmed text |
| `green` | `#3fb950` | Additions, positive |
| `red` | `#f85149` | Deletions, critical |
| `amber` | `#d29922` | Warnings |
| `blue` | `#58a6ff` | Info, links |
| `accent` | `#6e40c9` | Brand accent (purple) |

---

## Animation utilities

Defined in `styles.ts`:

| Function | Description |
|----------|-------------|
| `springEntrance(frame, delay)` | Spring physics: opacity 0→1, translateY 20→0 |
| `slideIn(frame, delay, direction)` | Horizontal slide from left or right |
| `fadeIn(frame, delay, duration)` | Linear opacity fade |
| `stagger(index)` | Returns delay frames for nth item in a list |

Audio playback is delayed by `AUDIO_DELAY_FRAMES` (12 frames = 0.4s) to let visual elements appear before narration starts.
