import React from "react";
import { Composition } from "remotion";
import { PRReview } from "./PRReview";
import { prReviewSchema, type PRReviewProps } from "../../types";
import { getSceneDuration, FPS } from "./styles";

const WIDTH = 1920;
const HEIGHT = 1080;

function computeTotalDuration(props: PRReviewProps): number {
  const durations = props.audioDurations ?? {};
  let total = 0;

  if (props.showTitleCard !== false) {
    total += getSceneDuration(FPS, 5, 8, durations["title"]);
  }
  if (props.showFileOverview !== false) {
    total += getSceneDuration(FPS, 5, 8, durations["file-overview"]);
  }

  props.fileReviews.forEach((_, i) => {
    total += getSceneDuration(FPS, 6, 12, durations[`diff-${i}`]);
  });

  if (props.risks.length > 0) {
    total += getSceneDuration(FPS, 5, 10, durations["risk"]);
  }

  if (props.showDiscussion !== false && props.discussion?.hasDiscussion) {
    total += getSceneDuration(FPS, 5, 10, durations["discussion"]);
  }

  if (props.showSummary !== false) {
    total += getSceneDuration(FPS, 5, 8, durations["summary"]);
  }

  // Clamp to 30-120 seconds
  const minFrames = 30 * FPS;
  const maxFrames = 120 * FPS;
  return Math.max(minFrames, Math.min(maxFrames, total));
}

const defaultProps: PRReviewProps = {
  prTitle: "Add user authentication middleware",
  prNumber: 42,
  authorLogin: "developer",
  authorAvatarUrl: "https://avatars.githubusercontent.com/u/0?v=4",
  repoFullName: "acme/webapp",
  baseBranch: "main",
  headBranch: "feat/auth-middleware",
  stats: {
    totalAdditions: 142,
    totalDeletions: 38,
    filesChanged: 7,
    languages: ["TypeScript", "JSON"],
  },
  fileReviews: [
    {
      filename: "src/middleware/auth.ts",
      purpose: "New JWT authentication middleware for Express routes",
      narration: "This file adds a new authentication middleware.",
      significance: "high",
      additions: 86,
      deletions: 0,
      language: "typescript",
      highlightedHunks: [
        {
          html: '<span style="color:#7ee787">+ import { verify } from "jsonwebtoken";</span>\n<span style="color:#7ee787">+ import type { Request, Response, NextFunction } from "express";</span>\n<span style="color:#e6edf3"> </span>\n<span style="color:#7ee787">+ export function authMiddleware(req: Request, res: Response, next: NextFunction) {</span>\n<span style="color:#7ee787">+   const token = req.headers.authorization?.split(" ")[1];</span>\n<span style="color:#7ee787">+   if (!token) return res.status(401).json({ error: "Missing token" });</span>\n<span style="color:#7ee787">+   try {</span>\n<span style="color:#7ee787">+     req.user = verify(token, process.env.JWT_SECRET!);</span>\n<span style="color:#7ee787">+     next();</span>\n<span style="color:#7ee787">+   } catch {</span>\n<span style="color:#7ee787">+     res.status(401).json({ error: "Invalid token" });</span>\n<span style="color:#7ee787">+   }</span>\n<span style="color:#7ee787">+ }</span>',
        },
      ],
    },
    {
      filename: "src/routes/index.ts",
      purpose: "Apply auth middleware to protected routes",
      narration: "The router now uses the auth middleware on protected endpoints.",
      significance: "medium",
      additions: 12,
      deletions: 4,
      language: "typescript",
      highlightedHunks: [
        {
          html: '<span style="color:#e6edf3"> import { Router } from "express";</span>\n<span style="color:#7ee787">+ import { authMiddleware } from "../middleware/auth";</span>\n<span style="color:#e6edf3"> </span>\n<span style="color:#e6edf3"> const router = Router();</span>\n<span style="color:#f85149">- router.get("/profile", getProfile);</span>\n<span style="color:#7ee787">+ router.get("/profile", authMiddleware, getProfile);</span>',
        },
      ],
    },
  ],
  risks: [
    {
      severity: "warning",
      category: "security",
      description:
        "JWT secret is read from process.env with a non-null assertion. Consider adding a startup check.",
    },
  ],
  overallSentiment: "cautious",
  summary:
    "This PR adds JWT authentication middleware and applies it to protected routes. The implementation is clean but the JWT secret handling could be more robust.",
  showTitleCard: true,
  showFileOverview: true,
  showSummary: true,
  showStats: true,
  showBranchInfo: true,
};

export const Root: React.FC = () => (
  <Composition
    id="PRReview"
    component={PRReview}
    durationInFrames={60 * FPS}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    schema={prReviewSchema}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: computeTotalDuration(props),
    })}
  />
);
