import type { Octokit } from "@octokit/rest";
import { parse as parseYAML } from "yaml";
import type { FileDiff, PRContext } from "../types";
import {
  DEFAULT_CONFIG,
  preelYAMLSchema,
  type ResolvedPreelConfig,
  type PreelYAMLConfig,
  type PartialPreelConfig,
} from "./schema";
import { BUILT_IN_PRESETS } from "./presets";
import { applyOverlay } from "./merge";
import { detectPreset } from "./detect";
import { parsePRBodyConfig } from "./parse-pr";

export interface ConfigResolutionResult {
  action: "review" | "skip";
  config: ResolvedPreelConfig;
  resolvedPreset: string;
  detectionSource: string;
}

/** Parse env var overrides (PREEL_* prefix) */
function parseEnvOverrides(): PartialPreelConfig {
  const config: PartialPreelConfig = {};

  const envVerbosity = process.env.PREEL_VERBOSITY;
  if (envVerbosity) {
    config.review = { verbosity: envVerbosity as PartialPreelConfig["review"] extends { verbosity?: infer V } ? V : never };
  }

  const envVoice = process.env.PREEL_TTS_VOICE || process.env.TTS_VOICE;
  const envSpeed = process.env.PREEL_TTS_SPEED || process.env.TTS_SPEED;
  const envTone = process.env.PREEL_TTS_TONE;
  if (envVoice || envSpeed || envTone) {
    config.tts = {};
    if (envVoice) config.tts.voice = envVoice as any;
    if (envSpeed) config.tts.speed = parseFloat(envSpeed);
    if (envTone) config.tts.tone = envTone as any;
  }

  const envMinDuration = process.env.PREEL_MIN_DURATION;
  const envMaxDuration = process.env.PREEL_MAX_DURATION;
  if (envMinDuration || envMaxDuration) {
    config.video = { duration: {} };
    if (envMinDuration) config.video.duration!.min = parseInt(envMinDuration, 10);
    if (envMaxDuration) config.video.duration!.max = parseInt(envMaxDuration, 10);
  }

  const envIgnore = process.env.PREEL_IGNORE;
  if (envIgnore) {
    config.filter = { ignore: envIgnore.split(",").map((s) => s.trim()) };
  }

  return config;
}

/** Fetch .preel.yml from the repo via GitHub Contents API */
async function fetchRepoConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<PreelYAMLConfig | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: ".preel.yml",
      ref,
    });

    if ("content" in data && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const raw = parseYAML(content);
      if (!raw || typeof raw !== "object") return null;

      const result = preelYAMLSchema.safeParse(raw);
      if (!result.success) {
        console.warn("Invalid .preel.yml:", result.error.message);
        return null;
      }
      return result.data;
    }
  } catch (err: any) {
    if (err.status !== 404) {
      console.warn("Failed to fetch .preel.yml:", err.message);
    }
    // 404 = no config file, that's fine
  }
  return null;
}

/** Look up a preset by name (built-in or custom from YAML) */
function lookupPreset(
  name: string,
  customPresets?: Record<string, PartialPreelConfig>,
): PartialPreelConfig | null {
  if (name === "default") return null;
  if (name === "skip") return null; // handled separately
  return customPresets?.[name] ?? BUILT_IN_PRESETS[name] ?? null;
}

/** Full config resolution pipeline */
export async function resolveConfig(
  octokit: Octokit,
  ctx: PRContext,
  diffs: FileDiff[],
): Promise<ConfigResolutionResult> {
  let config = { ...DEFAULT_CONFIG };
  let resolvedPreset = "default";
  let detectionSource = "default";

  // 1. Apply env var overrides
  const envOverrides = parseEnvOverrides();
  config = applyOverlay(config, envOverrides);

  // 2. Apply env preset
  const envPreset = process.env.PREEL_PRESET;
  if (envPreset) {
    const preset = lookupPreset(envPreset);
    if (preset) {
      config = applyOverlay(config, preset);
      resolvedPreset = envPreset;
    }
  }

  // 3. Fetch and apply .preel.yml
  let yamlConfig: PreelYAMLConfig | null = null;
  try {
    yamlConfig = await fetchRepoConfig(
      octokit,
      ctx.owner,
      ctx.repo,
      ctx.headSha,
    );
  } catch {
    // continue without repo config
  }

  if (yamlConfig) {
    // Apply base preset from YAML
    if (yamlConfig.preset) {
      const preset = lookupPreset(yamlConfig.preset, yamlConfig.presets);
      if (preset) {
        config = applyOverlay(config, preset);
        resolvedPreset = yamlConfig.preset;
      }
    }

    // Apply inline YAML config
    const inlineConfig: PartialPreelConfig = {
      review: yamlConfig.review,
      scenes: yamlConfig.scenes,
      tts: yamlConfig.tts,
      video: yamlConfig.video,
      filter: yamlConfig.filter,
      comments: yamlConfig.comments,
    };
    config = applyOverlay(config, inlineConfig);

    // Apply auto_detect and labels config
    if (yamlConfig.auto_detect) {
      const ad = yamlConfig.auto_detect;
      if (ad.conventional_commits)
        Object.assign(config.auto_detect.conventional_commits, ad.conventional_commits);
      if (ad.labels)
        Object.assign(config.auto_detect.labels, ad.labels);
      if (ad.file_patterns)
        config.auto_detect.file_patterns = ad.file_patterns;
      if (ad.branch_patterns)
        config.auto_detect.branch_patterns = ad.branch_patterns;
    }

    if (yamlConfig.labels) {
      if (yamlConfig.labels.opt_in !== undefined)
        config.labels.opt_in = yamlConfig.labels.opt_in;
      if (yamlConfig.labels.skip)
        config.labels.skip = yamlConfig.labels.skip;
    }
  }

  // 4. Check opt-in mode
  const prLabels = ctx.labels ?? [];
  if (config.labels.opt_in) {
    const hasPreelLabel = prLabels.some((l) => l.startsWith("preel:"));
    if (!hasPreelLabel) {
      return { action: "skip", config, resolvedPreset, detectionSource: "opt-in:no-label" };
    }
  }

  // 5. Check skip labels
  if (prLabels.some((l) => config.labels.skip.includes(l))) {
    return { action: "skip", config, resolvedPreset, detectionSource: "label:skip" };
  }

  // 6. Auto-detect preset from PR characteristics
  const detection = detectPreset(ctx, diffs, config.auto_detect);
  if (detection.preset) {
    if (detection.preset === "skip") {
      return { action: "skip", config, resolvedPreset: "skip", detectionSource: detection.source };
    }
    const preset = lookupPreset(detection.preset, yamlConfig?.presets);
    if (preset) {
      config = applyOverlay(config, preset);
      resolvedPreset = detection.preset;
      detectionSource = detection.source;
    }
  }

  // 7. Apply PR body overrides (highest priority)
  const bodyConfig = parsePRBodyConfig(ctx.body);
  if (bodyConfig) {
    config = applyOverlay(config, bodyConfig);
    detectionSource = "pr-body";
  }

  // 8. Check size gates
  const totalChanges = diffs.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );
  if (diffs.length < config.filter.min_files || totalChanges < config.filter.min_changes) {
    return { action: "skip", config, resolvedPreset, detectionSource: "filter:too-small" };
  }
  if (diffs.length > config.filter.max_files || totalChanges > config.filter.max_changes) {
    if (config.filter.max_exceeded_action === "skip") {
      return { action: "skip", config, resolvedPreset, detectionSource: "filter:too-large" };
    }
    // Switch to quick preset
    const quick = BUILT_IN_PRESETS.quick;
    if (quick) {
      config = applyOverlay(config, quick);
      resolvedPreset = "quick";
      detectionSource = "filter:auto-quick";
    }
  }

  return { action: "review", config, resolvedPreset, detectionSource };
}

/** Resolve config for CLI (no GitHub API, reads local .preel.yml) */
export function resolveLocalConfig(
  presetName?: string,
): ResolvedPreelConfig {
  let config = { ...DEFAULT_CONFIG };

  // Apply env overrides
  config = applyOverlay(config, parseEnvOverrides());

  // Apply preset
  if (presetName && presetName !== "default") {
    const preset = BUILT_IN_PRESETS[presetName];
    if (preset) config = applyOverlay(config, preset);
  }

  return config;
}
