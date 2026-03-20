import { z } from "zod";

// ── Enums ────────────────────────────────────────────────────

export const focusPriority = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "ignore",
]);
export type FocusPriority = z.infer<typeof focusPriority>;

export const verbosity = z.enum([
  "brief",
  "standard",
  "detailed",
  "explanatory",
]);
export type Verbosity = z.infer<typeof verbosity>;

export const significance = z.enum(["high", "medium", "low"]);
export type Significance = z.infer<typeof significance>;

export const ttsVoice = z.enum([
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
]);
export type TTSVoice = z.infer<typeof ttsVoice>;

export const ttsTone = z.enum([
  "professional",
  "casual",
  "technical",
  "friendly",
]);
export type TTSTone = z.infer<typeof ttsTone>;

export const focusArea = z.enum([
  "security",
  "performance",
  "testing",
  "architecture",
  "style",
  "breaking_changes",
]);
export type FocusArea = z.infer<typeof focusArea>;

// ── Partial schemas (YAML input / user overrides) ────────────

export const analysisDepth = z.enum(["fast", "standard", "deep"]);
export type AnalysisDepth = z.infer<typeof analysisDepth>;

export const partialReviewSchema = z
  .object({
    verbosity: verbosity.optional(),
    max_files_analyzed: z.number().min(1).max(50).optional(),
    analysis_depth: analysisDepth.optional(),
    focus: z.record(focusArea, focusPriority).optional(),
    custom_instructions: z.string().optional(),
  })
  .strict()
  .optional();

export const partialDiffWalkthroughSchema = z.object({
  enabled: z.boolean().optional(),
  max_files: z.number().min(1).max(30).optional(),
  skip_significance: z.array(significance).optional(),
});

export const partialScenesSchema = z
  .object({
    title_card: z.boolean().optional(),
    file_overview: z.boolean().optional(),
    diff_walkthrough: z
      .union([z.boolean(), partialDiffWalkthroughSchema])
      .optional(),
    risk_callout: z.boolean().optional(),
    discussion: z.boolean().optional(),
    summary: z.boolean().optional(),
  })
  .strict()
  .optional();

export const partialTTSSchema = z
  .object({
    voice: ttsVoice.optional(),
    speed: z.number().min(0.5).max(2.0).optional(),
    tone: ttsTone.optional(),
  })
  .strict()
  .optional();

export const partialVideoSchema = z
  .object({
    duration: z
      .object({
        min: z.number().min(10).max(300).optional(),
        max: z.number().min(10).max(300).optional(),
      })
      .optional(),
    show_stats: z.boolean().optional(),
    show_branch_info: z.boolean().optional(),
    narrate_stats: z.boolean().optional(),
  })
  .strict()
  .optional();

export const filePatternRuleSchema = z.object({
  pattern: z.string(),
  only: z.boolean().optional(),
  preset: z.string(),
});

export const branchPatternRuleSchema = z.object({
  pattern: z.string(),
  preset: z.string(),
});

export const partialFilterSchema = z
  .object({
    ignore: z.array(z.string()).optional(),
    min_files: z.number().min(0).optional(),
    max_files: z.number().min(1).optional(),
    min_changes: z.number().min(0).optional(),
    max_changes: z.number().min(1).optional(),
    max_exceeded_action: z.enum(["skip", "quick"]).optional(),
  })
  .strict()
  .optional();

export const partialAutoDetectSchema = z
  .object({
    conventional_commits: z.record(z.string(), z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    file_patterns: z.array(filePatternRuleSchema).optional(),
    branch_patterns: z.array(branchPatternRuleSchema).optional(),
  })
  .strict()
  .optional();

export const partialLabelSchema = z
  .object({
    opt_in: z.boolean().optional(),
    skip: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export const partialCommentsSchema = z
  .object({
    enabled: z.boolean().optional(),
    include_bots: z.boolean().optional(),
    include_resolved: z.boolean().optional(),
    max_comments: z.number().min(1).max(200).optional(),
  })
  .strict()
  .optional();

/** A partial config — what presets store and what merging operates on */
export const partialPreelConfigSchema = z.object({
  review: partialReviewSchema,
  scenes: partialScenesSchema,
  tts: partialTTSSchema,
  video: partialVideoSchema,
  filter: partialFilterSchema,
  comments: partialCommentsSchema,
});
export type PartialPreelConfig = z.infer<typeof partialPreelConfigSchema>;

/** The full .pull-reviews.yml file schema */
export const preelYAMLSchema = z.object({
  preset: z.string().optional(),
  presets: z.record(z.string(), partialPreelConfigSchema).optional(),
  review: partialReviewSchema,
  scenes: partialScenesSchema,
  tts: partialTTSSchema,
  video: partialVideoSchema,
  filter: partialFilterSchema,
  comments: partialCommentsSchema,
  auto_detect: partialAutoDetectSchema,
  labels: partialLabelSchema,
});
export type PreelYAMLConfig = z.infer<typeof preelYAMLSchema>;

// ── Resolved (fully populated) ──────────────────────────────

export interface ResolvedReviewConfig {
  verbosity: Verbosity;
  max_files_analyzed: number;
  analysis_depth: AnalysisDepth;
  focus: Record<FocusArea, FocusPriority>;
  custom_instructions: string;
}

export interface ResolvedScenesConfig {
  title_card: boolean;
  file_overview: boolean;
  diff_walkthrough: {
    enabled: boolean;
    max_files: number;
    skip_significance: Significance[];
  };
  risk_callout: boolean;
  discussion: boolean;
  summary: boolean;
}

export interface ResolvedCommentsConfig {
  enabled: boolean;
  include_bots: boolean;
  include_resolved: boolean;
  max_comments: number;
}

export interface ResolvedTTSConfig {
  voice: TTSVoice;
  speed: number;
  tone: TTSTone;
}

export interface ResolvedVideoConfig {
  duration: { min: number; max: number };
  show_stats: boolean;
  show_branch_info: boolean;
  narrate_stats: boolean;
}

export interface ResolvedFilterConfig {
  ignore: string[];
  min_files: number;
  max_files: number;
  min_changes: number;
  max_changes: number;
  max_exceeded_action: "skip" | "quick";
}

export interface ResolvedAutoDetectConfig {
  conventional_commits: Record<string, string>;
  labels: Record<string, string>;
  file_patterns: z.infer<typeof filePatternRuleSchema>[];
  branch_patterns: z.infer<typeof branchPatternRuleSchema>[];
}

export interface ResolvedLabelConfig {
  opt_in: boolean;
  skip: string[];
}

export interface ResolvedPreelConfig {
  review: ResolvedReviewConfig;
  scenes: ResolvedScenesConfig;
  tts: ResolvedTTSConfig;
  video: ResolvedVideoConfig;
  filter: ResolvedFilterConfig;
  comments: ResolvedCommentsConfig;
  auto_detect: ResolvedAutoDetectConfig;
  labels: ResolvedLabelConfig;
}

// ── Default config ──────────────────────────────────────────

export const DEFAULT_CONFIG: ResolvedPreelConfig = {
  review: {
    verbosity: "standard",
    max_files_analyzed: 15,
    analysis_depth: "standard",
    focus: {
      security: "high",
      performance: "medium",
      testing: "medium",
      architecture: "medium",
      style: "low",
      breaking_changes: "high",
    },
    custom_instructions: "",
  },
  scenes: {
    title_card: true,
    file_overview: true,
    diff_walkthrough: {
      enabled: true,
      max_files: 5,
      skip_significance: ["low"],
    },
    risk_callout: true,
    discussion: true,
    summary: true,
  },
  tts: {
    voice: "onyx",
    speed: 1.1,
    tone: "professional",
  },
  video: {
    duration: { min: 30, max: 90 },
    show_stats: true,
    show_branch_info: true,
    narrate_stats: false,
  },
  comments: {
    enabled: true,
    include_bots: true,
    include_resolved: false,
    max_comments: 50,
  },
  filter: {
    ignore: [
      "**/*.lock",
      "**/package-lock.json",
      "**/yarn.lock",
      "**/pnpm-lock.yaml",
      "**/*.generated.*",
      "**/*.min.js",
      "**/*.min.css",
      "**/dist/**",
      "**/build/**",
      "**/vendor/**",
    ],
    min_files: 1,
    max_files: 100,
    min_changes: 1,
    max_changes: 5000,
    max_exceeded_action: "quick",
  },
  auto_detect: {
    conventional_commits: {
      feat: "default",
      fix: "default",
      refactor: "architecture",
      docs: "quick",
      test: "quick",
      chore: "quick",
      perf: "default",
      ci: "quick",
    },
    labels: {
      "preel:skip": "skip",
      "preel:quick": "quick",
      "preel:thorough": "thorough",
      "preel:security": "security",
      "preel:architecture": "architecture",
      "preel:onboarding": "onboarding",
    },
    file_patterns: [],
    branch_patterns: [
      { pattern: "^docs/", preset: "quick" },
      { pattern: "^(hotfix|security)/", preset: "security" },
      { pattern: "^refactor/", preset: "architecture" },
    ],
  },
  labels: {
    opt_in: false,
    skip: ["preel:skip", "no-video"],
  },
};
