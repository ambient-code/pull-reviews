import type { PartialPreelConfig } from "./schema";

export const BUILT_IN_PRESETS: Record<string, PartialPreelConfig> = {
  default: {},

  quick: {
    video: { duration: { min: 15, max: 30 } },
    scenes: {
      file_overview: false,
      risk_callout: true,
      discussion: false,
      diff_walkthrough: { max_files: 3, skip_significance: ["low", "medium"] },
    },
    review: { verbosity: "brief", max_files_analyzed: 5, analysis_depth: "fast" },
    tts: { speed: 1.25 },
    comments: { enabled: false },
  },

  thorough: {
    video: { duration: { min: 60, max: 120 } },
    scenes: {
      diff_walkthrough: { max_files: 20, skip_significance: [] },
    },
    review: { verbosity: "detailed", max_files_analyzed: 30, analysis_depth: "deep" },
    tts: { speed: 1.0 },
  },

  security: {
    review: {
      focus: {
        security: "critical",
        breaking_changes: "high",
        testing: "medium",
        performance: "low",
        architecture: "low",
        style: "ignore",
      },
      custom_instructions:
        "Focus heavily on authentication, authorization, input validation, SQL injection, XSS, CSRF, secrets exposure, and dependency vulnerabilities. Flag any use of eval, innerHTML, or raw SQL queries.",
    },
    scenes: {
      risk_callout: true,
      diff_walkthrough: { skip_significance: [] },
    },
  },

  architecture: {
    review: {
      focus: {
        architecture: "critical",
        breaking_changes: "high",
        security: "medium",
        performance: "medium",
        testing: "low",
        style: "low",
      },
      custom_instructions:
        "Focus on design patterns, abstractions, coupling, cohesion, separation of concerns, and SOLID principles. Evaluate whether new abstractions are justified.",
    },
    scenes: { diff_walkthrough: { max_files: 10 } },
  },

  onboarding: {
    review: {
      verbosity: "explanatory",
      custom_instructions:
        "Explain changes as if the reviewer is new to this codebase. Provide context about what surrounding code does, why patterns exist, and how the changes fit into the broader architecture. Avoid jargon without explanation.",
    },
    video: { duration: { min: 45, max: 120 } },
    tts: { speed: 0.95, tone: "friendly" },
  },
};
