import { z } from "zod";

// ── Diff parsing ─────────────────────────────────────────────

export interface FileDiff {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  language: string;
  hunks: DiffHunk[];
  oldFilename?: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// ── Claude review output ─────────────────────────────────────

export interface DiscussionSummary {
  hasDiscussion: boolean;
  toolsInvolved: string[];
  humanReviewers: string[];
  hasApproval: boolean;
  hasChangesRequested: boolean;
  /** LLM-generated summary of the discussion concerns */
  concernsSummary: string;
  /** Key points from human reviewers */
  humanConcerns: string[];
  /** Key points from review tools */
  toolConcerns: string[];
  /** Narration text for the discussion scene */
  narration: string;
}

export interface PRReviewData {
  summary: string;
  overallSentiment: "positive" | "neutral" | "cautious" | "concerning";
  fileReviews: FileReview[];
  risks: RiskItem[];
  stats: PRStats;
  discussion?: DiscussionSummary;
}

export interface FileReview {
  filename: string;
  purpose: string;
  narration: string;
  significance: "high" | "medium" | "low";
  keyChanges: string[];
}

export interface RiskItem {
  severity: "critical" | "warning" | "info";
  category:
    | "security"
    | "breaking-change"
    | "complexity"
    | "performance"
    | "testing";
  description: string;
  filename?: string;
}

export interface PRStats {
  totalAdditions: number;
  totalDeletions: number;
  filesChanged: number;
  languages: string[];
}

// ── Narration script ─────────────────────────────────────────

export interface NarrationScript {
  scenes: SceneScript[];
  totalEstimatedSeconds: number;
}

export interface SceneScript {
  sceneId: string;
  narrationText: string;
  estimatedSeconds: number;
}

// ── TTS output ───────────────────────────────────────────────

export interface TTSResult {
  audioFiles: Record<string, string>;
  audioDurations: Record<string, number>;
}

// ── Remotion input props ─────────────────────────────────────

export const prReviewSchema = z.object({
  prTitle: z.string(),
  prNumber: z.number(),
  authorLogin: z.string(),
  authorAvatarUrl: z.string(),
  repoFullName: z.string(),
  baseBranch: z.string(),
  headBranch: z.string(),
  stats: z.object({
    totalAdditions: z.number(),
    totalDeletions: z.number(),
    filesChanged: z.number(),
    languages: z.array(z.string()),
  }),
  fileReviews: z.array(
    z.object({
      filename: z.string(),
      purpose: z.string(),
      narration: z.string(),
      significance: z.enum(["high", "medium", "low"]),
      additions: z.number(),
      deletions: z.number(),
      language: z.string(),
      highlightedHunks: z.array(
        z.object({
          html: z.string(),
        }),
      ),
    }),
  ),
  risks: z.array(
    z.object({
      severity: z.enum(["critical", "warning", "info"]),
      category: z.string(),
      description: z.string(),
    }),
  ),
  overallSentiment: z.enum(["positive", "neutral", "cautious", "concerning"]),
  summary: z.string(),
  audioFiles: z.record(z.string()).optional(),
  audioDurations: z.record(z.number()).optional(),
  showTitleCard: z.boolean().optional(),
  showFileOverview: z.boolean().optional(),
  showSummary: z.boolean().optional(),
  showStats: z.boolean().optional(),
  showBranchInfo: z.boolean().optional(),
  showDiscussion: z.boolean().optional(),
  discussion: z
    .object({
      hasDiscussion: z.boolean(),
      toolsInvolved: z.array(z.string()),
      humanReviewers: z.array(z.string()),
      hasApproval: z.boolean(),
      hasChangesRequested: z.boolean(),
      concernsSummary: z.string(),
      humanConcerns: z.array(z.string()),
      toolConcerns: z.array(z.string()),
      narration: z.string(),
    })
    .optional(),
});

export type PRReviewProps = z.infer<typeof prReviewSchema>;

// ── Webhook context ──────────────────────────────────────────

export interface PRContext {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  authorLogin: string;
  authorAvatarUrl: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  labels?: string[];
  body?: string;
}
