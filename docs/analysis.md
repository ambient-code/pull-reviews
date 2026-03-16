# LLM Analysis

Preel uses a large language model to analyze PR diffs and generate structured review data. This document covers how the analysis works, how to configure it, and what it produces.

## Providers

| Provider | Model | Env var |
|----------|-------|---------|
| OpenAI (default) | `gpt-4o` | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Anthropic | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |

Set `LLM_PROVIDER=openai` or `LLM_PROVIDER=anthropic` to choose. Both produce the same structured JSON output.

---

## How it works

### Input

The LLM receives:

1. **System prompt** — dynamically constructed based on config (see below)
2. **User message** — PR metadata + diff text

The user message includes:
- PR title, author, repo, branch names
- Stats (additions, deletions, file count)
- Unified diff text (truncated at 100,000 characters)

Files are limited by `config.review.max_files_analyzed` (default: 15). Files beyond the limit are excluded from the diff text sent to the LLM.

### System prompt construction

The system prompt is built dynamically from the resolved config:

```
[Base instructions with JSON schema]
[Verbosity instructions]
[Focus area priorities]
[Areas to ignore]
[Custom instructions]
```

#### Verbosity

| Level | Instruction |
|-------|-------------|
| `brief` | Keep narration to 1 sentence per file. Focus on what changed, not why. |
| `standard` | 1-2 sentences per file. Cover what and why. |
| `detailed` | 2-3 sentences per file. Include context about the change's impact. |
| `explanatory` | 2-4 sentences per file. Explain concepts as if for someone new to the codebase. |

#### Focus areas

Focus areas are sorted by priority and presented as a prioritized list:

```
Pay special attention to these areas (in priority order):
1. security (critical priority)
2. breaking_changes (high priority)
3. performance (medium priority)
4. testing (medium priority)

Do NOT focus on these areas: style
```

Areas set to `ignore` are explicitly excluded from the review.

#### Custom instructions

The `custom_instructions` string is appended to the end of the system prompt. This allows repo-specific guidance:

```yaml
review:
  custom_instructions: |
    We use a hexagonal architecture pattern. Flag any domain logic
    that directly depends on infrastructure concerns.
    All API endpoints must have rate limiting.
```

---

## Output format

The LLM returns a JSON object matching `PRReviewData`:

```typescript
{
  summary: string;              // 2-3 sentence overall review
  overallSentiment: string;     // "positive" | "neutral" | "cautious" | "critical"
  stats: {
    totalAdditions: number;
    totalDeletions: number;
    filesChanged: number;
    languages: string[];
  };
  fileReviews: [
    {
      filename: string;
      purpose: string;          // one-line description of what the file change does
      narration: string;        // TTS-friendly narration text
      significance: string;     // "high" | "medium" | "low"
      keyChanges: string[];     // bullet points of notable changes
    }
  ];
  risks: [
    {
      severity: string;         // "critical" | "warning" | "info"
      category: string;         // "security" | "breaking-change" | "complexity" | "performance" | "testing"
      description: string;      // human-readable risk description
      filename?: string;        // optional: specific file related to this risk
    }
  ];
}
```

### File significance

Each file gets a significance rating that affects scene selection:

| Level | Meaning | Default behavior |
|-------|---------|-----------------|
| `high` | Core logic, API changes, security-relevant | Always shown in diff walkthrough |
| `medium` | Supporting changes, config updates | Shown if time permits |
| `low` | Minor/trivial changes | Skipped by default |

### Sentiment

| Value | Meaning | Video badge |
|-------|---------|-------------|
| `positive` | Clean, well-structured changes | Green ✓ |
| `neutral` | Standard changes, nothing notable | Gray → |
| `cautious` | Some concerns worth noting | Amber △ |
| `critical` | Significant issues identified | Red ! |

---

## Narration text

The `narration` field on each file review is specifically written for TTS consumption:

- Written in natural spoken language (not markdown or code)
- Avoids special characters, code syntax, and formatting
- References concepts without reciting code
- Length varies by verbosity setting

Example:
> "This file adds a new JWT authentication middleware for Express routes. It extracts the bearer token from the authorization header, verifies it against the JWT secret, and attaches the decoded user to the request object."

---

## Configuration reference

All settings under `review` in the config:

```yaml
review:
  verbosity: standard          # brief | standard | detailed | explanatory
  max_files_analyzed: 15       # 1-50, files sent to LLM
  focus:
    security: high             # critical | high | medium | low | ignore
    performance: medium
    testing: medium
    architecture: medium
    style: low
    breaking_changes: high
  custom_instructions: ""      # appended to system prompt
```

---

## Diff text construction

The diff sent to the LLM is built by `buildDiffText()`:

- Standard unified diff format (`--- a/file`, `+++ b/file`, `@@ ... @@`)
- Lines prefixed with `+`, `-`, or ` ` (space for context)
- Truncated at 100,000 characters with a note about omitted files
- Only files passing the ignore filter are included
- File count limited by `max_files_analyzed`

---

## Error handling

- If the LLM returns invalid JSON, the parse fails and the review is aborted
- The LLM response is parsed with `JSON.parse` (not Zod validation) for speed
- Provider-specific errors (rate limits, auth failures) propagate as pipeline errors
- The analysis logs: provider, model, character count, file/risk counts, and sentiment
