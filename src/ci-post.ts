/**
 * CI post-render step: upload video to R2 and post PR comment.
 *
 * Usage (called by GitHub Actions, not directly):
 *   npx tsx src/ci-post.ts <owner/repo> <pr-number> <video-path> <review-json-path>
 *
 * Env vars:
 *   GITHUB_TOKEN        — required (from actions)
 *   S3_ACCESS_KEY_ID    — required
 *   S3_SECRET_ACCESS_KEY — required
 *   S3_ENDPOINT         — optional (required for R2, omit for AWS S3)
 *   S3_REGION           — optional (default: auto)
 *   S3_BUCKET           — optional (default: preel-videos)
 *   CDN_BASE_URL        — required (public URL prefix for bucket)
 */

import fs from "node:fs";
import { Octokit } from "@octokit/rest";
import { uploadVideo } from "./storage";
import { postVideoComment } from "./github/comment";
import type { PRReviewData } from "./types";

async function main() {
  const [ownerRepo, prNumStr, videoPath, reviewJsonPath] = process.argv.slice(2);

  if (!ownerRepo || !prNumStr || !videoPath || !reviewJsonPath) {
    console.error("Usage: npx tsx src/ci-post.ts <owner/repo> <pr-number> <video-path> <review-json-path>");
    process.exit(1);
  }

  const [owner, repo] = ownerRepo.split("/");
  const prNumber = parseInt(prNumStr, 10);

  if (!owner || !repo || isNaN(prNumber)) {
    console.error("Invalid arguments");
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }

  if (!fs.existsSync(videoPath)) {
    console.error(`Video not found: ${videoPath}`);
    process.exit(1);
  }

  // Load the review data saved by the CLI
  const review: PRReviewData = JSON.parse(fs.readFileSync(reviewJsonPath, "utf-8"));

  const jobId = `ci-${owner}-${repo}-${prNumber}-${Date.now()}`;

  console.log("Uploading video to R2...");
  const videoUrl = await uploadVideo(jobId, videoPath);

  if (videoUrl === videoPath) {
    console.error("R2 upload failed — R2 credentials not configured");
    process.exit(1);
  }

  console.log(`Video URL: ${videoUrl}`);

  const octokit = new Octokit({ auth: token });
  const ctx = { installationId: 0, owner, repo, prNumber, prTitle: "", authorLogin: "", authorAvatarUrl: "", baseBranch: "", headBranch: "", headSha: "" };

  console.log("Posting PR comment...");
  await postVideoComment(octokit, ctx, videoUrl, review);

  console.log("Done!");
}

main().catch((err) => {
  console.error("ci-post error:", err);
  process.exit(1);
});
