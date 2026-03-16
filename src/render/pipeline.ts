import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  selectComposition,
  type RenderMediaOnProgress,
} from "@remotion/renderer";
import { createHighlighter, type Highlighter } from "shiki";
import { getInstallationOctokit } from "../github/app";
import { fetchPRDiff } from "../github/diff";
import { postVideoComment } from "../github/comment";
import { analyzeDiff } from "../analyze/reviewer";
import { generateScript } from "../analyze/script";
import { generateAllNarration, cleanupTTS } from "../tts/narrate";
import { fetchPRDiscussion } from "../github/comments";
import { uploadVideo } from "../storage";
import { OUTPUT_DIR, RENDER_CONCURRENCY, CHROME_EXECUTABLE, SCENE_MAP_ENABLED } from "../config";
import { resolveConfig } from "../config/resolve";
import { renderWithSceneMap, isFfmpegAvailable } from "./optimized";
import type { PRContext, PRReviewProps, FileDiff, PRReviewData } from "../types";

/** Run an async step and log how long it took */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  const ms = Date.now() - t0;
  const sec = (ms / 1000).toFixed(1);
  console.log(`  [${label}] ${sec}s`);
  return result;
}

// Cached Remotion bundle
let bundleLocation: string | null = null;

// Docker pre-builds the bundle to /app/build — use it if present
const PREBUILT_BUNDLE = path.resolve("build");

export async function ensureBundle(): Promise<string> {
  if (bundleLocation) return bundleLocation;

  if (fs.existsSync(path.join(PREBUILT_BUNDLE, "index.html"))) {
    bundleLocation = PREBUILT_BUNDLE;
    console.log(`Using pre-built bundle: ${bundleLocation}`);
    return bundleLocation;
  }

  console.log("Bundling Remotion project...");
  const entryPoint = path.resolve("src/index.tsx");

  bundleLocation = await bundle({
    entryPoint,
    onProgress: (progress) => {
      if (progress % 25 === 0) console.log(`Bundle: ${progress}%`);
    },
  });

  console.log(`Bundle ready: ${bundleLocation}`);
  return bundleLocation;
}

// Cached shiki highlighter
let highlighter: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter;
  highlighter = await createHighlighter({
    themes: ["github-dark"],
    langs: [
      "typescript", "javascript", "python", "rust", "go", "java",
      "ruby", "css", "html", "json", "yaml", "markdown", "shell",
      "sql", "swift", "kotlin", "cpp", "c", "toml", "xml", "vue",
      "svelte", "php", "dart",
    ],
  });
  return highlighter;
}

async function highlightDiffs(
  diffs: FileDiff[],
  review: PRReviewData,
): Promise<Map<string, { html: string }[]>> {
  const hl = await getHighlighter();
  const result = new Map<string, { html: string }[]>();

  for (const fileReview of review.fileReviews) {
    const diff = diffs.find((d) => d.filename === fileReview.filename);
    if (!diff || diff.hunks.length === 0) {
      result.set(fileReview.filename, []);
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
      const supportedLangs = hl.getLoadedLanguages();
      if (!supportedLangs.includes(lang as never)) lang = "text";

      try {
        const html = hl.codeToHtml(code, {
          lang: lang === "text" ? "javascript" : lang,
          theme: "github-dark",
          transformers: [
            {
              line(node, line) {
                const lineText = lines[line - 1];
                if (!lineText) return;
                if (lineText.type === "add") {
                  this.addClassToHast(node, "diff-add");
                  node.properties.style =
                    (node.properties.style || "") +
                    ";background-color:rgba(63,185,80,0.15);border-left:3px solid #3fb950;padding-left:8px;";
                } else if (lineText.type === "remove") {
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
        const escaped = code
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        hunks.push({
          html: `<pre style="color:#e6edf3;background:#161b22;padding:16px;border-radius:8px;overflow:hidden;"><code>${escaped}</code></pre>`,
        });
      }
    }

    result.set(fileReview.filename, hunks);
  }

  return result;
}

export async function processReview(ctx: PRContext): Promise<void> {
  const jobId = `${ctx.owner}-${ctx.repo}-${ctx.prNumber}-${ctx.headSha.slice(0, 7)}`;
  console.log(`\n=== Starting review: ${jobId} ===`);
  const startTime = Date.now();

  try {
    // 1. Get GitHub client
    const octokit = getInstallationOctokit(ctx.installationId);

    // 2. Fetch diff (raw, before filtering)
    const rawDiffs = await timed("Fetch diff", () =>
      fetchPRDiff(octokit, ctx.owner, ctx.repo, ctx.prNumber),
    );
    console.log(`  Fetched ${rawDiffs.length} files`);

    // 3. Resolve config (needs raw diffs for auto-detection)
    const { action, config, resolvedPreset, detectionSource } =
      await timed("Resolve config", () => resolveConfig(octokit, ctx, rawDiffs));

    console.log(`  Config: preset=${resolvedPreset}, source=${detectionSource}`);

    if (action === "skip") {
      console.log(`Skipping review: ${detectionSource}`);
      return;
    }

    // 4. Apply ignore filters to diffs
    const diffs = await timed("Filter diffs", () =>
      fetchPRDiff(octokit, ctx.owner, ctx.repo, ctx.prNumber, config.filter.ignore),
    );
    console.log(`  After filtering: ${diffs.length} files`);

    // 5. Fetch PR discussion (comments + reviews) if enabled
    let discussion = undefined;
    if (config.comments.enabled) {
      discussion = await timed("Fetch discussion", () =>
        fetchPRDiscussion(octokit, ctx.owner, ctx.repo, ctx.prNumber, config.comments.max_comments),
      );
      const commentCount = discussion.comments.length + discussion.reviews.length;
      console.log(`  Discussion: ${commentCount} items, tools: ${discussion.toolsInvolved.join(", ") || "none"}`);
    }

    // 6. AI analysis (includes discussion context)
    const review = await timed("AI analysis", () =>
      analyzeDiff(diffs, ctx, config.review, discussion),
    );

    // 7. Generate narration script
    const script = generateScript(review, ctx, config.scenes, config.video);
    console.log(
      `  Script: ${script.scenes.length} scenes, ~${script.totalEstimatedSeconds}s`,
    );

    // 8. TTS + syntax highlighting in parallel
    const [ttsResult, highlighted] = await timed("TTS + highlighting", () =>
      Promise.all([
        generateAllNarration(jobId, script, config.tts),
        highlightDiffs(diffs, review),
      ]),
    );

    // 9. Build Remotion input props
    // Re-map diff scene IDs: script uses original review indexes (diff-0, diff-1, diff-5)
    // but filtered fileReviews array creates sequential IDs (diff-0, diff-1, diff-2).
    const includedDiffs = review.fileReviews
      .map((fr, i) => ({ fr, origIdx: i, sceneId: `diff-${i}` }))
      .filter(({ sceneId }) => script.scenes.some((s) => s.sceneId === sceneId));

    const remappedAudioFiles: Record<string, string> = {};
    const remappedDurations: Record<string, number> = {};

    for (const [key, val] of Object.entries(ttsResult.audioFiles)) {
      if (!key.startsWith("diff-")) remappedAudioFiles[key] = val;
    }
    for (const [key, val] of Object.entries(ttsResult.audioDurations)) {
      if (!key.startsWith("diff-")) remappedDurations[key] = val;
    }

    includedDiffs.forEach(({ sceneId: origId }, newIdx) => {
      const newId = `diff-${newIdx}`;
      if (ttsResult.audioFiles[origId]) remappedAudioFiles[newId] = ttsResult.audioFiles[origId];
      if (ttsResult.audioDurations[origId] != null) remappedDurations[newId] = ttsResult.audioDurations[origId];
    });

    const inputProps: PRReviewProps = {
      prTitle: ctx.prTitle,
      prNumber: ctx.prNumber,
      authorLogin: ctx.authorLogin,
      authorAvatarUrl: ctx.authorAvatarUrl,
      repoFullName: `${ctx.owner}/${ctx.repo}`,
      baseBranch: ctx.baseBranch,
      headBranch: ctx.headBranch,
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

    // 10. Render video
    const serveUrl = await timed("Bundle", () => ensureBundle());

    // Copy TTS files into bundle public dir (needed even with scene-map
    // so composition doesn't error on staticFile() references)
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

      const onProgress: RenderMediaOnProgress = ({ progress }) => {
        if (Math.round(progress * 100) % 20 === 0) {
          console.log(`  Render: ${Math.round(progress * 100)}%`);
        }
      };

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
          onProgress,
          browserExecutable: CHROME_EXECUTABLE ?? null,
          chromiumOptions: { enableMultiProcessOnLinux: true },
        });
      });
    }

    console.log(`  Output: ${outputPath}`);

    // 11. Upload + comment
    const videoUrl = await timed("Upload", () => uploadVideo(jobId, outputPath));
    await timed("Post comment", () => postVideoComment(octokit, ctx, videoUrl, review));

    // 12. Cleanup
    cleanupTTS(jobId);
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`=== Review complete: ${jobId} (total ${elapsed}s) ===\n`);
  } catch (err) {
    console.error(`=== Review failed: ${jobId} ===`, err);
    throw err;
  }
}
