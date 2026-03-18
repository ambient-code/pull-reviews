/**
 * CLI for testing preel locally against a real GitHub PR.
 *
 * Usage:
 *   npx tsx src/cli.ts <owner/repo> <pr-number> [--preset=<name>]
 *   npx tsx src/cli.ts octocat/hello-world 42
 *   npx tsx src/cli.ts octocat/hello-world 42 --preset=security
 *
 * Env vars:
 *   GITHUB_TOKEN  — required (personal access token)
 *   OPENAI_API_KEY — required for TTS + analysis (when LLM_PROVIDER=openai)
 *   SKIP_TTS=1    — skip narration, render silently
 *
 * Presets: default, quick, thorough, security, architecture, onboarding
 */

import fs from "node:fs";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { fetchPRDiff } from "./github/diff";
import { analyzeDiff } from "./analyze/reviewer";
import { generateScript } from "./analyze/script";
import { generateAllNarration, cleanupTTS } from "./tts/narrate";
import { ensureBundle } from "./render/pipeline";
import { renderWithSceneMap, isFfmpegAvailable } from "./render/optimized";
import { OUTPUT_DIR, RENDER_CONCURRENCY, CHROME_EXECUTABLE, SCENE_MAP_ENABLED } from "./config";
import { resolveLocalConfig } from "./config/resolve";
import { fetchPRDiscussion } from "./github/comments";
import { createHighlighter } from "shiki";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { PRReviewProps } from "./types";

/** Run an async step and log how long it took */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  const ms = Date.now() - t0;
  const sec = (ms / 1000).toFixed(1);
  console.log(`  [${label}] ${sec}s`);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(
    args
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, v] = a.replace(/^--/, "").split("=");
        return [k, v ?? "true"];
      }),
  );

  if (positional.length < 2) {
    console.error(
      "Usage: npx tsx src/cli.ts <owner/repo> <pr-number> [options]",
    );
    console.error("Options:");
    console.error("  --preset=<name>      Preset: default, quick, thorough, security, architecture, onboarding");
    console.error("  --quick              Shorthand for --preset=quick");
    console.error("  --depth=<level>      fast (Haiku, no synthesis), standard, deep (Sonnet + LLM synthesis)");
    console.error("  --max-files=<n>      Max diff walkthrough files (default: 5)");
    console.error("  --verbosity=<level>  brief, standard, detailed, explanatory");
    process.exit(1);
  }

  const [ownerRepo, prNumStr] = positional;
  const [owner, repo] = ownerRepo.split("/");
  const prNumber = parseInt(prNumStr, 10);
  const skipTTS = process.env.SKIP_TTS === "1";
  const presetName = flags.quick === "true" ? "quick" : flags.preset;

  if (!owner || !repo || isNaN(prNumber)) {
    console.error("Invalid arguments. Expected: owner/repo pr-number");
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Set GITHUB_TOKEN env var (personal access token)");
    process.exit(1);
  }

  // Resolve config + apply CLI overrides
  const config = resolveLocalConfig(presetName);
  if (presetName) console.log(`Using preset: ${presetName}`);
  if (flags["max-files"]) {
    const n = parseInt(flags["max-files"], 10);
    if (!isNaN(n) && n > 0) {
      config.scenes.diff_walkthrough.max_files = n;
      console.log(`  Max diff files: ${n}`);
    }
  }
  if (flags.verbosity) {
    const v = flags.verbosity as "brief" | "standard" | "detailed" | "explanatory";
    if (["brief", "standard", "detailed", "explanatory"].includes(v)) {
      config.review.verbosity = v;
      console.log(`  Verbosity: ${v}`);
    }
  }
  if (flags.depth) {
    const d = flags.depth as "fast" | "standard" | "deep";
    if (["fast", "standard", "deep"].includes(d)) {
      config.review.analysis_depth = d;
      console.log(`  Analysis depth: ${d}`);
    }
  }

  const octokit = new Octokit({ auth: token });
  const pipelineStart = Date.now();

  console.log(`\n=== Reviewing PR #${prNumber} from ${owner}/${repo} ===`);
  const { data: pr } = await timed("Fetch PR", () =>
    octokit.pulls.get({ owner, repo, pull_number: prNumber }),
  );

  const diffs = await timed("Fetch diff", () =>
    fetchPRDiff(octokit, owner, repo, prNumber, config.filter.ignore),
  );
  console.log(`  ${diffs.length} files (after filtering)`);

  const ctx = {
    installationId: 0,
    owner,
    repo,
    prNumber,
    prTitle: pr.title,
    authorLogin: pr.user?.login ?? "unknown",
    authorAvatarUrl: pr.user?.avatar_url ?? "",
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
  };

  // Fetch PR discussion if comments are enabled
  let discussion = undefined;
  if (config.comments.enabled) {
    discussion = await timed("Fetch discussion", () =>
      fetchPRDiscussion(octokit, owner, repo, prNumber, config.comments.max_comments),
    );
    const commentCount = discussion.comments.length + discussion.reviews.length;
    console.log(`  Discussion: ${commentCount} items, tools: ${discussion.toolsInvolved.join(", ") || "none"}`);
  }

  const review = await timed("AI analysis", () =>
    analyzeDiff(diffs, ctx, config.review, discussion),
  );

  const script = generateScript(review, ctx, config.scenes, config.video);
  console.log(
    `  Script: ${script.scenes.length} scenes, ~${script.totalEstimatedSeconds}s`,
  );

  const jobId = `cli-${owner}-${repo}-${prNumber}`;
  let audioFiles: Record<string, string> = {};
  let audioDurations: Record<string, number> = {};

  // Run TTS and syntax highlighting in parallel — they're independent
  const highlightDiffs = async () => {
    const hl = await createHighlighter({
      themes: ["github-dark"],
      langs: [
        "typescript", "javascript", "python", "rust", "go", "java",
        "ruby", "css", "html", "json", "yaml", "shell", "sql",
      ],
    });

    const result = new Map<string, { html: string }[]>();
    for (const fr of review.fileReviews) {
      const diff = diffs.find((d) => d.filename === fr.filename);
      if (!diff || diff.hunks.length === 0) {
        result.set(fr.filename, []);
        continue;
      }

      const hunks: { html: string }[] = [];
      // Pick hunks with the most actual changes (not just imports/context)
      const scoredHunks = diff.hunks
        .map((hunk, idx) => {
          const changed = hunk.lines.filter((l) => l.type !== "context").length;
          return { hunk, idx, score: changed / Math.max(hunk.lines.length, 1) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .sort((a, b) => a.idx - b.idx); // restore file order

      for (const { hunk } of scoredHunks) {
        const lines = hunk.lines.slice(0, 40);
        const code = lines
          .map((l) => {
            const prefix = l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
            return `${prefix} ${l.content}`;
          })
          .join("\n");

        let lang = diff.language;
        if (!hl.getLoadedLanguages().includes(lang as never)) lang = "javascript";

        try {
          const html = hl.codeToHtml(code, {
            lang,
            theme: "github-dark",
            transformers: [
              {
                line(node, line) {
                  const lineData = lines[line - 1];
                  if (!lineData) return;
                  if (lineData.type === "add") {
                    this.addClassToHast(node, "diff-add");
                    node.properties.style =
                      (node.properties.style || "") +
                      ";background-color:rgba(63,185,80,0.15);border-left:3px solid #3fb950;padding-left:8px;";
                  } else if (lineData.type === "remove") {
                    this.addClassToHast(node, "diff-remove");
                    node.properties.style =
                      (node.properties.style || "") +
                      ";background-color:rgba(248,81,73,0.15);border-left:3px solid #f85149;padding-left:8px;opacity:0.7;";
                  } else {
                    node.properties.style =
                      (node.properties.style || "") + ";padding-left:11px;";
                  }
                },
              },
            ],
          });
          hunks.push({ html });
        } catch {
          const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          hunks.push({
            html: `<pre style="color:#e6edf3;background:#161b22;padding:16px;border-radius:8px;"><code>${escaped}</code></pre>`,
          });
        }
      }
      result.set(fr.filename, hunks);
    }
    return result;
  };

  let highlighted: Map<string, { html: string }[]>;

  if (!skipTTS) {
    const [tts, hl] = await Promise.all([
      timed("TTS generation", () => generateAllNarration(jobId, script, config.tts)),
      timed("Syntax highlighting", () => highlightDiffs()),
    ]);
    audioFiles = tts.audioFiles;
    audioDurations = tts.audioDurations;
    highlighted = hl;
  } else {
    console.log("  Skipping TTS (SKIP_TTS=1)");
    for (const scene of script.scenes) {
      audioDurations[scene.sceneId] = scene.estimatedSeconds;
    }
    highlighted = await timed("Syntax highlighting", () => highlightDiffs());
  }

  // Build filtered fileReviews and re-map diff scene IDs to sequential indexes.
  // Script uses original review indexes (diff-0, diff-1, diff-5, diff-7) but
  // inputProps.fileReviews is a filtered array so computeSceneLayout creates
  // sequential IDs (diff-0, diff-1, diff-2, diff-3). We must re-map audio to match.
  const includedDiffs = review.fileReviews
    .map((fr, i) => ({ fr, origIdx: i, sceneId: `diff-${i}` }))
    .filter(({ sceneId }) => script.scenes.some((s) => s.sceneId === sceneId));

  const remappedAudioFiles: Record<string, string> = {};
  const remappedDurations: Record<string, number> = {};

  // Copy non-diff entries as-is
  for (const [key, val] of Object.entries(audioFiles)) {
    if (!key.startsWith("diff-")) remappedAudioFiles[key] = val;
  }
  for (const [key, val] of Object.entries(audioDurations)) {
    if (!key.startsWith("diff-")) remappedDurations[key] = val;
  }

  // Re-map diff entries: diff-5 → diff-2, etc.
  includedDiffs.forEach(({ sceneId: origId }, newIdx) => {
    const newId = `diff-${newIdx}`;
    if (audioFiles[origId]) remappedAudioFiles[newId] = audioFiles[origId];
    if (audioDurations[origId] != null) remappedDurations[newId] = audioDurations[origId];
  });

  const inputProps: PRReviewProps = {
    prTitle: pr.title,
    prNumber,
    authorLogin: pr.user?.login ?? "unknown",
    authorAvatarUrl: pr.user?.avatar_url ?? "",
    repoFullName: `${owner}/${repo}`,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    stats: review.stats,
    fileReviews: includedDiffs.map(({ fr }) => {
      const diff = diffs.find((d) => d.filename === fr.filename);
      return {
        filename: fr.filename,
        purpose: fr.purpose,
        narration: fr.narration,
        significance: fr.significance,
        additions: diff?.additions ?? 0,
        deletions: diff?.deletions ?? 0,
        language: diff?.language ?? "text",
        highlightedHunks: highlighted.get(fr.filename) ?? [],
      };
    }),
    risks: review.risks.map((r) => ({
      severity: r.severity,
      category: r.category,
      description: r.description,
    })),
    overallSentiment: review.overallSentiment,
    summary: review.summary,
    audioDurations: remappedDurations,
    showTitleCard: config.scenes.title_card,
    showFileOverview: config.scenes.file_overview,
    showSummary: config.scenes.summary,
    showStats: config.video.show_stats,
    showBranchInfo: config.video.show_branch_info,
    showDiscussion: config.scenes.discussion,
    discussion: review.discussion,
  };

  const serveUrl = await timed("Bundle", () => ensureBundle());

  // Copy TTS files into bundle public dir (using remapped names)
  const bundlePublicDir = path.join(serveUrl, "public");
  fs.mkdirSync(bundlePublicDir, { recursive: true });
  for (const [sceneId, filePath] of Object.entries(remappedAudioFiles)) {
    fs.copyFileSync(filePath, path.join(bundlePublicDir, `${sceneId}.mp3`));
  }
  inputProps.audioFiles = Object.fromEntries(
    Object.keys(remappedAudioFiles).map((k) => [k, `${k}.mp3`]),
  );

  const outputDir = path.resolve(OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${jobId}.mp4`);

  const useSceneMap = SCENE_MAP_ENABLED && isFfmpegAvailable();
  if (SCENE_MAP_ENABLED && !useSceneMap) {
    console.log("  ffmpeg not found — falling back to standard render");
  }

  if (useSceneMap) {
    await timed("Video render (scene-map)", () =>
      renderWithSceneMap({
        serveUrl,
        inputProps,
        ttsAudioFiles: remappedAudioFiles,
        outputPath,
      }),
    );
  } else {
    const composition = await selectComposition({
      serveUrl,
      id: "PRReview",
      inputProps,
      browserExecutable: CHROME_EXECUTABLE ?? null,
    });

    await timed("Video render", async () => {
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: outputPath,
        inputProps,
        concurrency: RENDER_CONCURRENCY,
        imageFormat: "jpeg",
        jpegQuality: 80,
        onProgress: ({ progress }) => {
          if (Math.round(progress * 100) % 10 === 0) {
            process.stdout.write(`\rRender: ${Math.round(progress * 100)}%`);
          }
        },
        browserExecutable: CHROME_EXECUTABLE ?? null,
        chromiumOptions: { enableMultiProcessOnLinux: true },
      });
    });
  }

  console.log(`  Output: ${outputPath}`);

  // Save review data for CI post-processing (upload + comment)
  const reviewJsonPath = path.join(outputDir, `${jobId}-review.json`);
  fs.writeFileSync(reviewJsonPath, JSON.stringify(review, null, 2));
  console.log(`  Review data: ${reviewJsonPath}`);

  if (!skipTTS) cleanupTTS(jobId);

  const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  console.log(`\n--- Review Summary (total ${totalElapsed}s) ---`);
  console.log(`Preset: ${presetName ?? "default"}`);
  console.log(`Sentiment: ${review.overallSentiment}`);
  console.log(`Files: ${review.fileReviews.length}`);
  console.log(`Risks: ${review.risks.length}`);
  console.log(`Summary: ${review.summary}`);
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});
