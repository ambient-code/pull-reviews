import picomatch from "picomatch";
import type { FileDiff, PRContext } from "../types";
import type { ResolvedAutoDetectConfig } from "./schema";

interface DetectionResult {
  preset: string | null;
  source: string;
}

/** Detect PR type from conventional commit prefix in the title */
function detectFromTitle(
  title: string,
  mapping: Record<string, string>,
): DetectionResult {
  // Match conventional commit prefix: "feat: ...", "fix(scope): ...", etc.
  const match = title.match(/^(\w+)(?:\(.+?\))?[!]?:\s/);
  if (!match) return { preset: null, source: "none" };

  const prefix = match[1].toLowerCase();
  const preset = mapping[prefix] ?? null;
  return preset
    ? { preset, source: `commit:${prefix}` }
    : { preset: null, source: "none" };
}

/** Detect from branch name patterns */
function detectFromBranch(
  branch: string,
  patterns: { pattern: string; preset: string }[],
): DetectionResult {
  for (const rule of patterns) {
    if (new RegExp(rule.pattern).test(branch)) {
      return { preset: rule.preset, source: `branch:${rule.pattern}` };
    }
  }
  return { preset: null, source: "none" };
}

/** Detect from file patterns */
function detectFromFiles(
  diffs: FileDiff[],
  rules: { pattern: string; only?: boolean; preset: string }[],
): DetectionResult {
  const filenames = diffs.map((d) => d.filename);

  for (const rule of rules) {
    const matcher = picomatch(rule.pattern);
    const matching = filenames.filter((f) => matcher(f));

    if (rule.only) {
      // All files must match
      if (matching.length === filenames.length && filenames.length > 0) {
        return { preset: rule.preset, source: `files:${rule.pattern}(only)` };
      }
    } else {
      // Any file matches
      if (matching.length > 0) {
        return { preset: rule.preset, source: `files:${rule.pattern}` };
      }
    }
  }

  return { preset: null, source: "none" };
}

/** Detect from PR labels */
function detectFromLabels(
  labels: string[],
  mapping: Record<string, string>,
): DetectionResult {
  // Check in reverse so last-applied label wins
  for (const label of labels) {
    const preset = mapping[label];
    if (preset) {
      return { preset, source: `label:${label}` };
    }
  }
  return { preset: null, source: "none" };
}

/** Run all detection in priority order: branch → title → files → labels (labels win) */
export function detectPreset(
  ctx: PRContext,
  diffs: FileDiff[],
  autoDetect: ResolvedAutoDetectConfig,
): DetectionResult {
  // Priority: labels > file patterns > conventional commit > branch
  // We check in reverse priority so higher-priority overrides lower

  let result: DetectionResult = { preset: null, source: "default" };

  const branch = detectFromBranch(
    ctx.headBranch,
    autoDetect.branch_patterns,
  );
  if (branch.preset) result = branch;

  const commit = detectFromTitle(
    ctx.prTitle,
    autoDetect.conventional_commits,
  );
  if (commit.preset) result = commit;

  const files = detectFromFiles(diffs, autoDetect.file_patterns);
  if (files.preset) result = files;

  const labels = detectFromLabels(
    ctx.labels ?? [],
    autoDetect.labels,
  );
  if (labels.preset) result = labels;

  return result;
}
