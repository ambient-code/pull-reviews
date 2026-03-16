# Configuration

Preel resolves configuration through a layered system. Each layer can override settings from the one below it.

## Resolution order (lowest to highest priority)

1. **Built-in defaults** — sensible defaults for all options
2. **Environment variables** — override base settings
3. **`.preel.yml`** — per-repo configuration file (fetched via GitHub API)
4. **Auto-detection** — preset selected from branch name, commit prefix, file patterns, or labels
5. **PR body overrides** — inline YAML in the PR description

Higher-priority layers override lower ones. Within each layer, scalars replace, arrays replace (not concatenate), and objects merge recursively.

---

## Environment variables

These override the built-in defaults before any other config source is applied.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PREEL_PRESET` | string | — | Force a preset (e.g., `quick`, `security`) |
| `PREEL_VERBOSITY` | string | `standard` | Review verbosity: `brief`, `standard`, `detailed`, `explanatory` |
| `PREEL_TTS_VOICE` | string | `onyx` | TTS voice (see [TTS voices](#tts-voices)) |
| `PREEL_TTS_SPEED` | number | `1.1` | TTS speed multiplier (0.5–2.0) |
| `PREEL_TTS_TONE` | string | `professional` | TTS tone: `professional`, `casual`, `technical`, `friendly` |
| `PREEL_MIN_DURATION` | number | `30` | Minimum video duration in seconds |
| `PREEL_MAX_DURATION` | number | `90` | Maximum video duration in seconds |
| `PREEL_IGNORE` | string | — | Comma-separated glob patterns to ignore |

Additionally, these infrastructure env vars are loaded from `src/config.ts`:

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | `openai` (default) or `anthropic` |
| `OPENAI_API_KEY` | OpenAI API key for analysis + TTS |
| `OPENAI_MODEL` | OpenAI model for analysis (default: `gpt-4o`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (if using Claude) |
| `ANTHROPIC_MODEL` | Anthropic model (default: `claude-sonnet-4-20250514`) |
| `TTS_VOICE` | Fallback TTS voice (overridden by `PREEL_TTS_VOICE`) |
| `TTS_SPEED` | Fallback TTS speed (overridden by `PREEL_TTS_SPEED`) |
| `RENDER_CONCURRENCY` | Remotion render concurrency (default: `4`) |
| `REMOTION_CHROME_EXECUTABLE` | Path to Chromium binary |

---

## `.preel.yml`

Place a `.preel.yml` file in your repository root to configure Preel for all PRs in that repo. The file is fetched via the GitHub Contents API on each review.

### Full example

```yaml
# Base preset to start from (optional)
preset: default

# Custom presets for this repo
presets:
  frontend-review:
    review:
      focus:
        style: high
        architecture: medium
    tts:
      tone: casual
      speed: 1.2

# Review analysis settings
review:
  verbosity: standard          # brief | standard | detailed | explanatory
  max_files_analyzed: 15       # max files sent to LLM (1-50)
  focus:
    security: high             # critical | high | medium | low | ignore
    performance: medium
    testing: medium
    architecture: medium
    style: low
    breaking_changes: high
  custom_instructions: ""      # appended to LLM system prompt

# Scene toggles
scenes:
  title_card: true
  file_overview: true
  diff_walkthrough:
    enabled: true
    max_files: 8               # max diff scenes (1-30)
    skip_significance:
      - low                    # skip files with these significance levels
  risk_callout: true
  summary: true

# Text-to-speech
tts:
  voice: onyx                  # see TTS voices below
  speed: 1.1                   # 0.5-2.0
  tone: professional           # professional | casual | technical | friendly

# Video output
video:
  duration:
    min: 30                    # minimum seconds (10-300)
    max: 90                    # maximum seconds (10-300)
  show_stats: true             # show +/- stats in title card
  show_branch_info: true       # show base/head branch badges

# File filtering
filter:
  ignore:                      # glob patterns for files to skip
    - "**/*.lock"
    - "**/package-lock.json"
    - "**/dist/**"
  min_files: 1                 # skip PRs with fewer files
  max_files: 100               # skip or use quick preset for larger PRs
  min_changes: 1
  max_changes: 5000
  max_exceeded_action: quick   # skip | quick — what to do when max exceeded

# Auto-detection rules
auto_detect:
  conventional_commits:        # commit prefix → preset
    feat: default
    fix: default
    refactor: architecture
    docs: quick
    test: quick
    chore: quick
  labels:                      # PR label → preset
    preel:skip: skip
    preel:quick: quick
    preel:security: security
  file_patterns:               # file glob → preset
    - pattern: "**/*.test.*"
      preset: quick
    - pattern: "src/auth/**"
      preset: security
      only: true               # all files must match (not just some)
  branch_patterns:             # regex on head branch → preset
    - pattern: "^docs/"
      preset: quick
    - pattern: "^(hotfix|security)/"
      preset: security

# Label behavior
labels:
  opt_in: false                # if true, requires a preel:* label to run
  skip:                        # labels that skip review entirely
    - preel:skip
    - no-video
```

---

## Built-in presets

Use presets to quickly configure Preel for different review styles. Apply via `--preset` flag (CLI), `PREEL_PRESET` env var, `.preel.yml` `preset` key, labels, or auto-detection.

### `default`

Standard review with balanced settings. This is what runs when no preset is specified.

### `quick`

Fast, minimal review for small or routine changes.

- 15–30 second videos
- No file overview or risk callout scenes
- Only high-significance files in diff walkthrough (max 3)
- Brief verbosity, 1.25x TTS speed
- Max 5 files analyzed

### `thorough`

Deep, comprehensive review for important changes.

- 60–120 second videos
- All significance levels included (max 20 diff files)
- 30 files analyzed
- Detailed verbosity, 1.0x TTS speed

### `security`

Security-focused review.

- Security and breaking changes at critical/high priority
- Performance, testing at low; style and architecture ignored
- Risk callout enabled, file overview disabled
- Custom instructions focused on vulnerabilities, auth, injection, etc.

### `architecture`

Architecture and design review.

- Architecture focus at critical priority
- Custom instructions about patterns, coupling, abstractions
- 10 max diff files

### `onboarding`

Beginner-friendly review for new team members.

- Explanatory verbosity (assumes unfamiliarity)
- 45–120 second videos
- 0.95x TTS speed, friendly tone
- Custom instructions to explain conventions and context

---

## PR body overrides

Add a YAML block inside an HTML comment in your PR description to override config for that specific PR:

```markdown
## My PR description

Normal markdown content here...

<!-- preel
preset: security
review:
  verbosity: detailed
  focus:
    security: critical
tts:
  tone: technical
  speed: 1.0
scenes:
  risk_callout: true
  diff_walkthrough:
    max_files: 12
-->
```

The `<!-- preel ... -->` block is parsed as YAML and validated against the config schema. Invalid blocks are silently ignored (a warning is logged).

---

## Auto-detection

Preel can automatically select a preset based on PR characteristics. Detection runs in priority order (highest priority wins):

1. **Labels** — PR labels matched against `auto_detect.labels`
2. **File patterns** — Changed file paths matched against `auto_detect.file_patterns`
3. **Conventional commits** — PR title prefix matched against `auto_detect.conventional_commits`
4. **Branch patterns** — Head branch name matched against `auto_detect.branch_patterns`

### Conventional commit detection

Extracts the prefix from PR titles like `feat(scope): description` or `fix!: description`. Maps the prefix to a preset.

### Branch pattern detection

Matches the head branch name against regex patterns. Example: `hotfix/critical-bug` matches `^(hotfix|security)/`.

### File pattern detection

Uses picomatch glob patterns against changed file paths. When `only: true`, all changed files must match the pattern (useful for "this is purely a docs PR").

### Label detection

Direct label-to-preset mapping. The label `preel:skip` is special — it causes the review to be skipped entirely.

---

## Size gates

After config resolution, Preel checks file and change counts against the filter settings:

- If file count < `min_files` or change count < `min_changes` → skip
- If file count > `max_files` or change count > `max_changes`:
  - `max_exceeded_action: skip` → skip review
  - `max_exceeded_action: quick` → switch to quick preset

---

## TTS voices

Available OpenAI TTS voices:

| Voice | Character |
|-------|-----------|
| `alloy` | Neutral, balanced |
| `ash` | Warm, engaging |
| `coral` | Clear, professional |
| `echo` | Deep, authoritative |
| `fable` | Expressive, storytelling |
| `nova` | Friendly, upbeat |
| `onyx` | Deep, confident (default) |
| `sage` | Calm, measured |
| `shimmer` | Bright, energetic |

## TTS tones

| Tone | Description |
|------|-------------|
| `professional` | Calm, informative, moderate pace (default) |
| `casual` | Conversational, like explaining to a colleague |
| `technical` | Precise terminology, efficient |
| `friendly` | Warm, encouraging, mentoring style |

---

## Focus areas

Control how much attention the LLM gives to each area:

| Area | Description |
|------|-------------|
| `security` | Vulnerabilities, auth, injection, data exposure |
| `performance` | Efficiency, scaling, resource usage |
| `testing` | Test coverage, edge cases, test quality |
| `architecture` | Design patterns, coupling, abstractions |
| `style` | Code style, naming, formatting |
| `breaking_changes` | API changes, backwards compatibility |

Priority levels: `critical` > `high` > `medium` > `low` > `ignore`

Areas set to `ignore` are excluded from the review prompt entirely.
