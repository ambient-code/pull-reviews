import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import AnthropicVertex from "@anthropic-ai/vertex-sdk";
import {
  LLM_PROVIDER,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  VERTEX_PROJECT,
  VERTEX_LOCATION,
  VERTEX_MODEL,
  LLM_FAST_MODEL,
} from "../config";
import type { PRContext, FileDiff, PRReviewData, FileReview, RiskItem } from "../types";
import type { ResolvedReviewConfig } from "../config/schema";
import { buildDiffText } from "../github/diff";
import type { PRDiscussion } from "../github/comments";
import { buildDiscussionText } from "../github/comments";

// ── LLM call layer ─────────────────────────────────────────────

/** Resolve which model to use. If modelOverride is set, use it. */
function resolveModel(modelOverride?: string): string {
  const override = modelOverride || "";
  if (LLM_PROVIDER === "anthropic") return override || ANTHROPIC_MODEL;
  if (LLM_PROVIDER === "vertex") return override || VERTEX_MODEL;
  return override || OPENAI_MODEL;
}

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 8192,
  modelOverride?: string,
): Promise<string> {
  const model = resolveModel(modelOverride);

  if (LLM_PROVIDER === "anthropic") {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const r = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    return r.content[0].type === "text" ? r.content[0].text : "";
  }

  if (LLM_PROVIDER === "vertex") {
    const client = new AnthropicVertex({
      projectId: VERTEX_PROJECT,
      region: VERTEX_LOCATION,
    });
    const r = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    return r.content[0].type === "text" ? r.content[0].text : "";
  }

  // OpenAI
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const r = await client.chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  });
  return r.choices[0].message.content ?? "";
}

function parseJSON<T>(text: string): T {
  const cleaned = text
    .replace(/^```json?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callLLMWithRetry<T>(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 8192,
  maxRetries = 2,
  modelOverride?: string,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const text = await callLLM(systemPrompt, userMessage, maxTokens, modelOverride);
    try {
      return parseJSON<T>(text);
    } catch (err) {
      if (attempt >= maxRetries) {
        console.error(`JSON parse failed after ${attempt + 1} attempts. Response length: ${text.length}`);
        throw err;
      }
      console.warn(`JSON parse failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
    }
  }
}

// ── Prompts ─────────────────────────────────────────────────────

const VERBOSITY_INSTRUCTIONS: Record<string, string> = {
  brief:
    "\nBe extremely concise. Narrations should be 1 sentence each. Skip low-significance files. Summary should be 1 sentence.",
  standard:
    "\nBe concise and direct. Narrations should be 1-2 sentences. Focus on what matters.",
  detailed:
    "\nProvide thorough narrations of 2-3 sentences per file. Explain the reasoning behind changes.",
  explanatory:
    "\nExplain changes as if the reviewer is new to the codebase. 2-4 sentences per file.",
};

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  ignore: 4,
};

function buildFocusInstructions(reviewConfig: ResolvedReviewConfig): string {
  let extra = "";

  const focusLines = Object.entries(reviewConfig.focus)
    .filter(([_, p]) => p !== "ignore")
    .sort((a, b) => (PRIORITY_ORDER[a[1]] ?? 2) - (PRIORITY_ORDER[b[1]] ?? 2))
    .map(([area, priority]) => `- ${area.replace("_", " ")}: ${priority} priority`);

  if (focusLines.length > 0) {
    extra += `\nFocus areas:\n${focusLines.join("\n")}`;
  }

  const ignored = Object.entries(reviewConfig.focus)
    .filter(([_, p]) => p === "ignore")
    .map(([area]) => area.replace("_", " "));
  if (ignored.length > 0) {
    extra += `\nDo NOT comment on: ${ignored.join(", ")}`;
  }

  if (reviewConfig.custom_instructions) {
    extra += `\nAdditional instructions:\n${reviewConfig.custom_instructions}`;
  }

  return extra;
}

// ── Batch file review prompt ────────────────────────────────────

const BATCH_SYSTEM_PROMPT = `You are a senior software engineer reviewing files from a pull request.
Analyze the diff for each file and produce a structured review.

Your output MUST be valid JSON:
{
  "fileReviews": [
    {
      "filename": "path/to/file.ts",
      "purpose": "What this file change accomplishes",
      "narration": "TTS-friendly explanation. Describe conceptually, no code. Written to be spoken aloud.",
      "significance": "high" | "medium" | "low",
      "keyChanges": ["bullet point descriptions"]
    }
  ],
  "risks": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "security" | "breaking-change" | "complexity" | "performance" | "testing",
      "description": "Clear description of the risk",
      "filename": "optional/file.ts"
    }
  ],
  "batchSummary": "One sentence describing what these file changes accomplish together"
}

Return ONLY the JSON object, no markdown fences.
Order fileReviews by significance (high first).`;

// ── Summary/synthesis prompt ────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are synthesizing a pull request review from individual file analyses.
Given the file review summaries and discussion data below, produce an overall assessment.

Your output MUST be valid JSON:
{
  "summary": "1-2 sentence overall summary of what the PR does",
  "overallSentiment": "positive" | "neutral" | "cautious" | "concerning",
  "additionalRisks": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "security" | "breaking-change" | "complexity" | "performance" | "testing",
      "description": "Cross-cutting risk not visible in individual files"
    }
  ],
  "discussion": {
    "concernsSummary": "1-2 sentence summary of the main discussion concerns",
    "humanConcerns": ["Key point from human reviewer"],
    "toolConcerns": ["Key finding from review tools"],
    "narration": "TTS-friendly 1-2 sentence summary of the discussion. Mention tools/reviewers by name."
  }
}

Return ONLY the JSON.
If there is no discussion data, set discussion to null.
additionalRisks should only contain cross-cutting concerns not already in individual file risks.`;

// ── Batch size ──────────────────────────────────────────────────

const BATCH_SIZE = 5;

// ── Phase 1: Parallel file review batches ───────────────────────

interface BatchResult {
  fileReviews: FileReview[];
  risks: RiskItem[];
  batchSummary?: string;
}

async function analyzeFileBatch(
  diffs: FileDiff[],
  ctx: PRContext,
  reviewConfig: ResolvedReviewConfig | undefined,
  batchIdx: number,
  totalBatches: number,
): Promise<BatchResult> {
  const diffText = buildDiffText(diffs);
  const verbosity = VERBOSITY_INSTRUCTIONS[reviewConfig?.verbosity ?? "standard"]
    ?? VERBOSITY_INSTRUCTIONS.standard;
  const focus = reviewConfig ? buildFocusInstructions(reviewConfig) : "";

  const system = BATCH_SYSTEM_PROMPT + verbosity + focus;
  const user = `PR #${ctx.prNumber}: ${ctx.prTitle}
Author: ${ctx.authorLogin}
Batch ${batchIdx + 1}/${totalBatches} (${diffs.length} files)

Diff:
${diffText}`;

  // deep mode uses the main model for higher-quality analysis
  const depth = reviewConfig?.analysis_depth ?? "standard";
  const fastModel = depth === "deep" ? undefined : (LLM_FAST_MODEL || undefined);
  console.log(`  Batch ${batchIdx + 1}/${totalBatches}: ${diffs.length} files, ${user.length} chars${fastModel ? ` (${fastModel})` : ""}`);

  const result = await callLLMWithRetry<BatchResult>(system, user, 2048, 2, fastModel);

  console.log(`  Batch ${batchIdx + 1}/${totalBatches}: done (${result.fileReviews.length} reviews, ${result.risks.length} risks)`);
  return result;
}

// ── Phase 2: Summary synthesis ──────────────────────────────────

interface SynthesisResult {
  summary: string;
  overallSentiment: "positive" | "neutral" | "cautious" | "concerning";
  additionalRisks: RiskItem[];
  discussion: {
    concernsSummary: string;
    humanConcerns: string[];
    toolConcerns: string[];
    narration: string;
  } | null;
}

async function synthesizeSummary(
  fileReviews: FileReview[],
  risks: RiskItem[],
  ctx: PRContext,
  stats: PRReviewData["stats"],
  discussion: PRDiscussion | undefined,
  reviewConfig: ResolvedReviewConfig | undefined,
): Promise<SynthesisResult> {
  // Build compact file review summary for the synthesis prompt
  const reviewSummary = fileReviews
    .map(
      (fr) =>
        `- ${fr.filename} [${fr.significance}]: ${fr.purpose}` +
        (fr.keyChanges.length > 0 ? `\n  Changes: ${fr.keyChanges.join("; ")}` : ""),
    )
    .join("\n");

  const riskSummary =
    risks.length > 0
      ? risks
          .map((r) => `- [${r.severity}/${r.category}] ${r.description}`)
          .join("\n")
      : "None identified.";

  const discussionText = discussion ? buildDiscussionText(discussion) : "";

  const verbosity = VERBOSITY_INSTRUCTIONS[reviewConfig?.verbosity ?? "standard"]
    ?? VERBOSITY_INSTRUCTIONS.standard;

  const system = SUMMARY_SYSTEM_PROMPT + verbosity;
  const user = `PR #${ctx.prNumber}: ${ctx.prTitle}
Branch: ${ctx.headBranch} → ${ctx.baseBranch}
Author: ${ctx.authorLogin}
Files changed: ${stats.filesChanged} (+${stats.totalAdditions} / -${stats.totalDeletions})
Languages: ${stats.languages.join(", ")}

File Reviews:
${reviewSummary}

Risks Found:
${riskSummary}
${discussionText}`;

  const fastModel = LLM_FAST_MODEL || undefined;
  console.log(`  Synthesis: ${user.length} chars${fastModel ? ` (${fastModel})` : ""}`);
  const result = await callLLMWithRetry<SynthesisResult>(system, user, 2048, 2, fastModel);
  console.log(`  Synthesis: done`);
  return result;
}

// ── Single-shot fallback (for small PRs) ────────────────────────

const SINGLE_SHOT_SYSTEM = `You are a senior software engineer reviewing a pull request. Analyze the diff and produce a structured review.

Your output MUST be valid JSON matching this schema exactly:
{
  "summary": "1-2 sentence overall summary of the PR",
  "overallSentiment": "positive" | "neutral" | "cautious" | "concerning",
  "fileReviews": [
    {
      "filename": "path/to/file.ts",
      "purpose": "What this file change accomplishes",
      "narration": "TTS-friendly explanation. Describe conceptually, no code. Written to be spoken aloud.",
      "significance": "high" | "medium" | "low",
      "keyChanges": ["bullet point descriptions"]
    }
  ],
  "risks": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "security" | "breaking-change" | "complexity" | "performance" | "testing",
      "description": "Clear description of the risk",
      "filename": "optional/file.ts"
    }
  ],
  "stats": {
    "totalAdditions": number,
    "totalDeletions": number,
    "filesChanged": number,
    "languages": ["typescript", "python"]
  }
}

If PR discussion data is provided below, incorporate it into your review:
- Acknowledge concerns raised by human reviewers and review tools (CodeRabbit, Codex, Claude, Copilot, etc.)
- Summarize the key discussion points rather than repeating them
- Include a "discussion" field in your JSON output if discussion data is present

When discussion data is present, add this field to the JSON:
"discussion": {
  "concernsSummary": "1-2 sentence summary of the main discussion concerns",
  "humanConcerns": ["Key point from human reviewer 1", "Key point 2"],
  "toolConcerns": ["Key finding from CodeRabbit", "Key finding from Codex"],
  "narration": "TTS-friendly 1-2 sentence summary of the discussion. Mention tools and reviewers by name."
}

Return ONLY the JSON object, no markdown fences.
Order fileReviews by significance (high first).
If there are no risks, return an empty risks array.
If there is no discussion data, omit the discussion field.`;

// ── Fast programmatic synthesis (no LLM call) ───────────────────

function fastSynthesis(
  batchResults: BatchResult[],
  fileReviews: FileReview[],
  risks: RiskItem[],
  discussion: PRDiscussion | undefined,
): SynthesisResult {
  // Summary: pick the best batch summary (most high-significance files)
  const ranked = batchResults
    .map((b) => ({
      summary: b.batchSummary?.replace(/[.\s]+$/, "").replace(/^this batch\s+/i, ""),
      highCount: b.fileReviews.filter((f) => f.significance === "high").length,
    }))
    .filter((b) => b.summary && b.summary.length > 0)
    .sort((a, b) => b.highCount - a.highCount);

  const summary = ranked.length > 0
    ? ranked[0].summary + "."
    : fileReviews
        .filter((f) => f.significance === "high")
        .slice(0, 3)
        .map((f) => f.purpose)
        .join(". ") + ".";

  // Sentiment: derive from risk profile
  const criticals = risks.filter((r) => r.severity === "critical").length;
  const warnings = risks.filter((r) => r.severity === "warning").length;
  let overallSentiment: SynthesisResult["overallSentiment"] = "neutral";
  if (criticals >= 2) overallSentiment = "concerning";
  else if (criticals === 1 || warnings >= 4) overallSentiment = "cautious";
  else if (risks.length <= 3 && criticals === 0) overallSentiment = "positive";

  // Discussion: derive from PRDiscussion data
  let disc: SynthesisResult["discussion"] = null;
  if (discussion && (discussion.comments.length > 0 || discussion.reviews.length > 0)) {
    const humans = discussion.humanReviewers;
    const tools = discussion.toolsInvolved;
    const parts: string[] = [];
    if (humans.length > 0) parts.push(`reviewed by ${humans.join(" and ")}`);
    if (tools.length > 0) parts.push(`analyzed by ${tools.join(" and ")}`);

    let statusNote = "";
    if (discussion.hasChangesRequested) statusNote = " Changes have been requested.";
    else if (discussion.hasApproval) statusNote = " It has been approved.";

    disc = {
      concernsSummary: discussion.hasChangesRequested
        ? "Reviewers have requested changes."
        : discussion.hasApproval
          ? "The pull request has been approved."
          : "The review discussion is ongoing.",
      humanConcerns: humans.map((h) => `Review from ${h}`),
      toolConcerns: tools.map((t) => `Automated analysis from ${t}`),
      narration: parts.length > 0
        ? `This pull request has been ${parts.join(" and ")}.${statusNote}`
        : "There is some discussion activity on this pull request.",
    };
  }

  return { summary, overallSentiment, additionalRisks: [], discussion: disc };
}

// ── Exported for pipeline overlap ────────────────────────────────

export { analyzeFileBatch, synthesizeSummary, BATCH_SIZE };
export type { BatchResult, SynthesisResult };

// ── Main entry point ────────────────────────────────────────────

export type AnalysisDepth = "fast" | "standard" | "deep";

export async function analyzeDiff(
  diffs: FileDiff[],
  ctx: PRContext,
  reviewConfig?: ResolvedReviewConfig,
  discussion?: PRDiscussion,
): Promise<PRReviewData> {
  const stats: PRReviewData["stats"] = {
    totalAdditions: diffs.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: diffs.reduce((sum, f) => sum + f.deletions, 0),
    filesChanged: diffs.length,
    languages: [
      ...new Set(diffs.map((f) => f.language).filter((l) => l !== "text")),
    ],
  };

  const maxFiles = reviewConfig?.max_files_analyzed ?? 15;
  const limitedDiffs = diffs.slice(0, maxFiles);

  const providerNames: Record<string, string> = {
    anthropic: "Anthropic",
    vertex: "Vertex AI",
    openai: "OpenAI",
  };
  const modelNames: Record<string, string> = {
    anthropic: ANTHROPIC_MODEL,
    vertex: VERTEX_MODEL,
    openai: OPENAI_MODEL,
  };
  const provider = providerNames[LLM_PROVIDER] ?? "OpenAI";
  const model = modelNames[LLM_PROVIDER] ?? OPENAI_MODEL;

  // Use parallel batches for larger PRs, single-shot for small ones
  const useBatched = limitedDiffs.length > BATCH_SIZE;

  if (useBatched) {
    return analyzeBatched(limitedDiffs, ctx, stats, reviewConfig, discussion, provider, model);
  }
  return analyzeSingleShot(limitedDiffs, ctx, stats, reviewConfig, discussion, provider, model);
}

// ── Parallel batched analysis ───────────────────────────────────

async function analyzeBatched(
  diffs: FileDiff[],
  ctx: PRContext,
  stats: PRReviewData["stats"],
  reviewConfig: ResolvedReviewConfig | undefined,
  discussion: PRDiscussion | undefined,
  provider: string,
  model: string,
): Promise<PRReviewData> {
  // Split into batches
  const batches: FileDiff[][] = [];
  for (let i = 0; i < diffs.length; i += BATCH_SIZE) {
    batches.push(diffs.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `Analyzing with ${provider} (${model}), ${diffs.length} files in ${batches.length} parallel batches...`,
  );

  // Phase 1: Parallel file reviews
  const t0 = Date.now();
  const batchResults = await Promise.all(
    batches.map((batch, i) =>
      analyzeFileBatch(batch, ctx, reviewConfig, i, batches.length),
    ),
  );
  console.log(`  Batches complete: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const fileReviews = batchResults.flatMap((r) => r.fileReviews);
  const risks = batchResults.flatMap((r) => r.risks);

  // Phase 2: Synthesis
  const depth = reviewConfig?.analysis_depth ?? "standard";
  let synthesis: SynthesisResult;
  if (depth === "deep") {
    // Full LLM synthesis — better summaries + cross-cutting risk detection
    const t1 = Date.now();
    synthesis = await synthesizeSummary(fileReviews, risks, ctx, stats, discussion, reviewConfig);
    console.log(`  Synthesis (deep): ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  } else {
    // Fast programmatic synthesis — no extra LLM call
    synthesis = fastSynthesis(batchResults, fileReviews, risks, discussion);
  }

  // Merge additional cross-cutting risks
  const allRisks = [...risks, ...(synthesis.additionalRisks ?? [])];

  // Build discussion summary
  let discussionSummary = undefined;
  if (discussion && (discussion.comments.length > 0 || discussion.reviews.length > 0)) {
    const d = synthesis.discussion;
    discussionSummary = {
      hasDiscussion: true,
      toolsInvolved: discussion.toolsInvolved,
      humanReviewers: discussion.humanReviewers,
      hasApproval: discussion.hasApproval,
      hasChangesRequested: discussion.hasChangesRequested,
      concernsSummary: d?.concernsSummary ?? "No major concerns raised.",
      humanConcerns: d?.humanConcerns ?? [],
      toolConcerns: d?.toolConcerns ?? [],
      narration: d?.narration ?? "The PR discussion shows no major concerns.",
    };
  }

  console.log(
    `Review complete: ${fileReviews.length} files, ${allRisks.length} risks, sentiment: ${synthesis.overallSentiment}`,
  );

  return {
    summary: synthesis.summary,
    overallSentiment: synthesis.overallSentiment,
    fileReviews,
    risks: allRisks,
    stats,
    discussion: discussionSummary,
  };
}

// ── Single-shot analysis (small PRs) ────────────────────────────

async function analyzeSingleShot(
  diffs: FileDiff[],
  ctx: PRContext,
  stats: PRReviewData["stats"],
  reviewConfig: ResolvedReviewConfig | undefined,
  discussion: PRDiscussion | undefined,
  provider: string,
  model: string,
): Promise<PRReviewData> {
  let systemPrompt = SINGLE_SHOT_SYSTEM;
  if (reviewConfig) {
    systemPrompt +=
      (VERBOSITY_INSTRUCTIONS[reviewConfig.verbosity] ?? VERBOSITY_INSTRUCTIONS.standard) +
      buildFocusInstructions(reviewConfig);
  } else {
    systemPrompt += VERBOSITY_INSTRUCTIONS.standard;
  }

  const diffText = buildDiffText(diffs);
  const discussionText = discussion ? buildDiscussionText(discussion) : "";

  const userMessage = `PR #${ctx.prNumber}: ${ctx.prTitle}
Branch: ${ctx.headBranch} → ${ctx.baseBranch}
Author: ${ctx.authorLogin}
Files changed: ${stats.filesChanged} (+${stats.totalAdditions} / -${stats.totalDeletions})
Languages: ${stats.languages.join(", ")}

Diff:
${diffText}
${discussionText}`;

  const depth = reviewConfig?.analysis_depth ?? "standard";
  const fastModel = depth === "deep" ? undefined : (LLM_FAST_MODEL || undefined);
  const displayModel = fastModel || model;
  console.log(
    `Analyzing with ${provider} (${displayModel}), ${userMessage.length} chars...`,
  );

  const review = await callLLMWithRetry<PRReviewData>(systemPrompt, userMessage, 4096, 2, fastModel);
  review.stats = stats;

  // Attach discussion summary
  if (discussion && (discussion.comments.length > 0 || discussion.reviews.length > 0)) {
    const llmDiscussion = (review as any).discussion;
    review.discussion = {
      hasDiscussion: true,
      toolsInvolved: discussion.toolsInvolved,
      humanReviewers: discussion.humanReviewers,
      hasApproval: discussion.hasApproval,
      hasChangesRequested: discussion.hasChangesRequested,
      concernsSummary: llmDiscussion?.concernsSummary ?? "No major concerns raised.",
      humanConcerns: llmDiscussion?.humanConcerns ?? [],
      toolConcerns: llmDiscussion?.toolConcerns ?? [],
      narration: llmDiscussion?.narration ?? "The PR discussion shows no major concerns.",
    };
  }

  console.log(
    `Review complete: ${review.fileReviews.length} files, ${review.risks.length} risks, sentiment: ${review.overallSentiment}`,
  );

  return review;
}
