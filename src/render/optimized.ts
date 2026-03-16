/**
 * Optimized video renderer using scene-map approach.
 *
 * Instead of rendering every frame through Chromium, we:
 *   1. Detect which portions of each scene are animated vs static
 *   2. Render only the animated portion as a short clip (muted, h264-ts)
 *   3. Capture the "settled" frame as a PNG still
 *   4. Loop the PNG into an h264-ts video via ffmpeg (ultrafast)
 *   5. Build the audio track directly via ffmpeg (adelay + amix)
 *   6. Concatenate all segments + audio via ffmpeg stream-copy
 *
 * For a typical 70s video this reduces rendered frames from ~2100 to ~300,
 * cutting render time by 80-90%.
 */

import fs from "node:fs";
import path from "node:path";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import type { PRReviewProps } from "../types";
import {
  RENDER_CONCURRENCY,
  CHROME_EXECUTABLE,
} from "../config";
import { getSceneDuration, FPS, AUDIO_DELAY_FRAMES, SCROLL_PX_PER_FRAME, SCROLL_START_FRAME } from "./compositions/styles";

const execAsync = promisify(exec);

// Max concurrent Remotion render/still calls (each starts its own server)
const MAX_CONCURRENT_RENDERS = 6;

/** Run async tasks with a concurrency limit */
async function pool<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Check if ffmpeg is available */
let _ffmpegAvailable: boolean | null = null;
export function isFfmpegAvailable(): boolean {
  if (_ffmpegAvailable !== null) return _ffmpegAvailable;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    _ffmpegAvailable = true;
  } catch {
    _ffmpegAvailable = false;
  }
  return _ffmpegAvailable;
}

// ── Scene settle times (frames) ────────────────────────────────
// How many frames until spring animations are visually settled.
// Must be >= the last staggered item's entrance + spring settle (~20 frames).
const SETTLE_FRAMES: Record<string, number> = {
  title: 30,
  "file-overview": 45,
  risk: 60,
  discussion: 60,
  summary: 30,
};
const DEFAULT_SETTLE = 36; // diff scenes, ~1.2s
const MIN_HOLD_FRAMES = 15; // don't bother with holds < 0.5s

// ── Types ──────────────────────────────────────────────────────

interface SceneLayout {
  from: number;
  duration: number;
  id: string;
}

interface SceneSegment {
  label: string;
  startFrame: number;
  endFrame: number;
  type: "static" | "animated";
  settleFrame?: number; // global frame where animation is settled
}

// ── Scene layout (mirrors PRReview.tsx) ────────────────────────

function computeSceneLayout(props: PRReviewProps): SceneLayout[] {
  const fps = FPS;
  const durations = props.audioDurations ?? {};
  const scenes: SceneLayout[] = [];
  let offset = 0;

  if (props.showTitleCard !== false) {
    const d = getSceneDuration(fps, 5, 8, durations["title"]);
    scenes.push({ from: offset, duration: d, id: "title" });
    offset += d;
  }

  if (props.showFileOverview !== false) {
    const d = getSceneDuration(fps, 5, 8, durations["file-overview"]);
    scenes.push({ from: offset, duration: d, id: "file-overview" });
    offset += d;
  }

  props.fileReviews.forEach((_, i) => {
    const d = getSceneDuration(fps, 6, 12, durations[`diff-${i}`]);
    scenes.push({ from: offset, duration: d, id: `diff-${i}` });
    offset += d;
  });

  if (props.risks.length > 0) {
    const d = getSceneDuration(fps, 5, 10, durations["risk"]);
    scenes.push({ from: offset, duration: d, id: "risk" });
    offset += d;
  }

  if (props.showDiscussion !== false && props.discussion?.hasDiscussion) {
    const d = getSceneDuration(fps, 5, 10, durations["discussion"]);
    scenes.push({ from: offset, duration: d, id: "discussion" });
    offset += d;
  }

  if (props.showSummary !== false) {
    const d = getSceneDuration(fps, 5, 8, durations["summary"]);
    scenes.push({ from: offset, duration: d, id: "summary" });
    offset += d;
  }

  return scenes;
}

// ── Scene segments ─────────────────────────────────────────────

function getSettleCount(sceneId: string): number {
  if (SETTLE_FRAMES[sceneId]) return SETTLE_FRAMES[sceneId];
  // diff-0, diff-1, etc.
  const prefix = sceneId.replace(/-\d+$/, "");
  return SETTLE_FRAMES[prefix] ?? DEFAULT_SETTLE;
}

/** Check which diff scenes need scrolling (content overflows viewport) */
function computeScrollableScenes(props: PRReviewProps): Set<string> {
  const scrollable = new Set<string>();
  const LINE_HEIGHT_PX = 30.6;
  const VIEWPORT_HEIGHT = 700;

  props.fileReviews.forEach((fr, i) => {
    const totalLines = fr.highlightedHunks.reduce((sum, h) => {
      // Count Shiki line spans, or fall back to newline count + 1
      const lineSpans = (h.html.match(/class="line"/g) || []).length;
      return sum + (lineSpans > 0 ? lineSpans : (h.html.match(/\n/g) || []).length + 1);
    }, 0);
    const contentHeight = totalLines * LINE_HEIGHT_PX;
    if (contentHeight > VIEWPORT_HEIGHT) {
      scrollable.add(`diff-${i}`);
    }
  });

  return scrollable;
}

function computeSegments(layout: SceneLayout[], fullyAnimated?: Set<string>): SceneSegment[] {
  const segments: SceneSegment[] = [];

  for (const scene of layout) {
    const start = scene.from;
    const end = scene.from + scene.duration - 1;
    const settle = fullyAnimated?.has(scene.id) ? scene.duration : getSettleCount(scene.id);
    const holdFrames = scene.duration - settle;

    if (holdFrames < MIN_HOLD_FRAMES) {
      // Too short to split — render entirely as animated
      segments.push({
        label: scene.id,
        startFrame: start,
        endFrame: end,
        type: "animated",
      });
    } else {
      // Animated entrance
      const animEnd = start + settle - 1;
      segments.push({
        label: `${scene.id}-anim`,
        startFrame: start,
        endFrame: animEnd,
        type: "animated",
      });
      // Static hold (capture frame at animEnd+1 which is fully settled)
      segments.push({
        label: `${scene.id}-hold`,
        startFrame: animEnd + 1,
        endFrame: end,
        type: "static",
        settleFrame: animEnd + 1,
      });
    }
  }

  return segments;
}

// ── ffmpeg helpers ─────────────────────────────────────────────

function ffmpeg(args: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`ffmpeg ${args}`, { maxBuffer: 10 * 1024 * 1024 });
}

async function pngToVideo(
  pngPath: string,
  durationSec: number,
  fps: number,
  outPath: string,
): Promise<void> {
  await ffmpeg(
    `-loop 1 -i "${pngPath}" -t ${durationSec.toFixed(3)} -r ${fps} ` +
    `-c:v libx264 -pix_fmt yuvj420p -preset ultrafast -f mpegts ` +
    `-loglevel error -y "${outPath}"`,
  );
}

async function buildAudioTrack(
  audioFiles: Record<string, string>,
  layout: SceneLayout[],
  totalDurationSec: number,
  fps: number,
  outputPath: string,
): Promise<void> {
  // Collect audio inputs with their time offsets
  const inputs: { file: string; delaySec: number; maxDurSec: number }[] = [];

  for (const scene of layout) {
    const file = audioFiles[scene.id];
    if (!file || !fs.existsSync(file)) continue;
    const delaySec = (scene.from + AUDIO_DELAY_FRAMES) / fps;
    const maxDurSec = scene.duration / fps;
    inputs.push({ file, delaySec, maxDurSec });
  }

  if (inputs.length === 0) {
    // Silent track
    await ffmpeg(
      `-f s16le -ar 44100 -ac 2 -t ${totalDurationSec.toFixed(3)} ` +
      `-i /dev/zero -c:a aac -loglevel error -y "${outputPath}"`,
    );
    return;
  }

  // Build ffmpeg filter_complex: position each audio at its scene offset
  const inputArgs = inputs.map((i) => `-i "${i.file}"`).join(" ");
  const filters = inputs
    .map((input, idx) => {
      const delayMs = Math.round(input.delaySec * 1000);
      return (
        `[${idx}]atrim=end=${input.maxDurSec.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDurationSec.toFixed(3)}[a${idx}]`
      );
    })
    .join(";");

  const mixInputs = inputs.map((_, idx) => `[a${idx}]`).join("");
  // amix divides volume by number of inputs (since all are padded/active).
  // Compensate with volume boost, and resample to 44.1kHz for player compatibility.
  const filterComplex = `${filters};${mixInputs}amix=inputs=${inputs.length}:duration=first:normalize=0,volume=${inputs.length}[out]`;

  await ffmpeg(
    `${inputArgs} -filter_complex "${filterComplex}" ` +
    `-map "[out]" -ar 44100 -c:a aac -loglevel error -y "${outputPath}"`,
  );
}

async function concatSegments(
  segmentPaths: string[],
  audioPath: string,
  outputPath: string,
): Promise<void> {
  // Write concat manifest
  const manifestPath = outputPath.replace(/\.mp4$/, ".manifest.txt");
  const manifest = segmentPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(manifestPath, manifest);

  await ffmpeg(
    `-f concat -safe 0 -i "${manifestPath}" -i "${audioPath}" ` +
    `-c:v copy -c:a copy -movflags +faststart ` +
    `-loglevel error -y "${outputPath}"`,
  );

  // Cleanup manifest
  try { fs.unlinkSync(manifestPath); } catch { /* ignore */ }
}

// ── Main render function ───────────────────────────────────────

export async function renderWithSceneMap(opts: {
  serveUrl: string;
  inputProps: PRReviewProps;
  ttsAudioFiles: Record<string, string>;
  outputPath: string;
  onProgress?: (phase: string, detail: string) => void;
}): Promise<void> {
  const { serveUrl, inputProps, ttsAudioFiles, outputPath, onProgress } = opts;
  const fps = FPS;
  const log = (phase: string, detail: string) => {
    onProgress?.(phase, detail);
    console.log(`    [scene-map] ${phase}: ${detail}`);
  };

  // 1. Select composition
  const composition = await selectComposition({
    serveUrl,
    id: "PRReview",
    inputProps,
    browserExecutable: CHROME_EXECUTABLE ?? null,
  });

  // 2. Compute scene layout + segments
  const layout = computeSceneLayout(inputProps);
  const scrollableScenes = computeScrollableScenes(inputProps);
  const segments = computeSegments(layout, scrollableScenes);

  const animatedSegs = segments.filter((s) => s.type === "animated");
  const staticSegs = segments.filter(
    (s) => s.type === "static" && s.settleFrame != null,
  );

  const totalFrames = composition.durationInFrames;
  const animFrames = animatedSegs.reduce(
    (s, seg) => s + (seg.endFrame - seg.startFrame + 1), 0,
  );
  const savedFrames = totalFrames - animFrames;
  const savedPct = totalFrames > 0 ? Math.round((savedFrames / totalFrames) * 100) : 0;

  if (scrollableScenes.size > 0) {
    log("plan", `scrollable diffs: ${[...scrollableScenes].join(", ")} (rendered fully animated)`);
  }
  log("plan", `${segments.length} segments (${animatedSegs.length} animated, ${staticSegs.length} static), skipping ${savedPct}% of frames`);

  // 3. Create temp directory
  const tmpDir = path.join(path.dirname(outputPath), `tmp-scenemap-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 4. Phase 1: Render clips + capture stills + build audio
    // Remotion spawns a server per render call, so we limit concurrency
    // to avoid port exhaustion.
    const totalCores = RENDER_CONCURRENCY;
    const clipConcurrency = Math.max(
      1,
      Math.floor(totalCores / Math.min(animatedSegs.length, MAX_CONCURRENT_RENDERS)),
    );

    log("render", `${animatedSegs.length} clips (${clipConcurrency} cores each), ${staticSegs.length} stills, max ${MAX_CONCURRENT_RENDERS} concurrent`);

    // Build all render tasks (clips + stills) into a single pool
    type SegResult = { label: string; path: string; startFrame: number };

    const renderTasks: (() => Promise<SegResult>)[] = [];

    for (const seg of animatedSegs) {
      renderTasks.push(async () => {
        const outFile = path.join(tmpDir, `${seg.label}.ts`);
        try {
          await renderMedia({
            composition,
            serveUrl,
            codec: "h264-ts",
            outputLocation: outFile,
            inputProps,
            frameRange: [seg.startFrame, seg.endFrame],
            muted: true,
            concurrency: clipConcurrency,
            imageFormat: "jpeg",
            jpegQuality: 80,
            chromiumOptions: { enableMultiProcessOnLinux: true },
            browserExecutable: CHROME_EXECUTABLE ?? null,
            logLevel: "warn",
          });
        } catch (err: any) {
          // ProtocolError from Remotion browser cleanup is harmless — check output exists
          if (err?.name === "ProtocolError" && fs.existsSync(outFile)) {
            // ignore — output was written successfully
          } else {
            throw err;
          }
        }
        return { label: seg.label, path: outFile, startFrame: seg.startFrame };
      });
    }

    for (const seg of staticSegs) {
      renderTasks.push(async () => {
        const pngPath = path.join(tmpDir, `${seg.label}.png`);
        try {
          await renderStill({
            composition,
            serveUrl,
            output: pngPath,
            frame: seg.settleFrame!,
            inputProps,
            imageFormat: "png",
            chromiumOptions: { enableMultiProcessOnLinux: true },
            browserExecutable: CHROME_EXECUTABLE ?? null,
            logLevel: "warn",
          });
        } catch (err: any) {
          if (err?.name === "ProtocolError" && fs.existsSync(pngPath)) {
            // ignore — still was captured
          } else {
            throw err;
          }
        }

        // Convert PNG → looped h264-ts video
        const holdDuration = (seg.endFrame - seg.startFrame + 1) / fps;
        const tsPath = path.join(tmpDir, `${seg.label}.ts`);
        await pngToVideo(pngPath, holdDuration, fps, tsPath);

        return { label: seg.label, path: tsPath, startFrame: seg.startFrame };
      });
    }

    // Suppress harmless ProtocolError from Remotion browser cleanup
    const suppressProtocol = (err: unknown) => {
      if (err && typeof err === "object" && (err as any).name === "ProtocolError") return;
      console.error(err);
    };
    process.on("unhandledRejection", suppressProtocol);

    // Run audio build in parallel with the pooled render tasks
    const totalDurationSec = totalFrames / fps;
    const audioPath = path.join(tmpDir, "audio.aac");

    const [renderResults] = await Promise.all([
      pool(renderTasks, MAX_CONCURRENT_RENDERS),
      buildAudioTrack(ttsAudioFiles, layout, totalDurationSec, fps, audioPath),
    ]);

    process.off("unhandledRejection", suppressProtocol);

    log("render", "clips + stills + audio complete");

    // 5. Sort all segments by start frame and concat
    const sorted = [...renderResults].sort(
      (a, b) => a.startFrame - b.startFrame,
    );
    const segmentPaths = sorted.map((r) => r.path);

    log("concat", `${segmentPaths.length} segments → final MP4`);

    await concatSegments(segmentPaths, audioPath, outputPath);

    log("done", `output: ${outputPath}`);
  } finally {
    // 6. Cleanup temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Chunked fallback (when scene map is disabled) ──────────────

export async function renderChunked(opts: {
  serveUrl: string;
  inputProps: PRReviewProps;
  outputPath: string;
  numChunks?: number;
  onProgress?: (pct: number) => void;
}): Promise<void> {
  const { serveUrl, inputProps, outputPath, onProgress } = opts;
  const numChunks = opts.numChunks ?? 6;

  const composition = await selectComposition({
    serveUrl,
    id: "PRReview",
    inputProps,
    browserExecutable: CHROME_EXECUTABLE ?? null,
  });

  const total = composition.durationInFrames;
  const framesPerChunk = Math.ceil(total / numChunks);
  const totalCores = RENDER_CONCURRENCY;
  const perChunkConcurrency = Math.max(1, Math.floor(totalCores / numChunks));

  const tmpDir = path.join(path.dirname(outputPath), `tmp-chunks-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    console.log(`    [chunked] ${numChunks} chunks, ${perChunkConcurrency} cores each`);

    const chunkPromises = Array.from({ length: numChunks }, async (_, i) => {
      const start = i * framesPerChunk;
      const end = Math.min(start + framesPerChunk - 1, total - 1);
      if (start > end) return null;

      const chunkPath = path.join(tmpDir, `chunk-${i}.ts`);
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264-ts",
        outputLocation: chunkPath,
        inputProps,
        frameRange: [start, end],
        concurrency: perChunkConcurrency,
        imageFormat: "jpeg",
        jpegQuality: 80,
        chromiumOptions: { enableMultiProcessOnLinux: true },
        browserExecutable: CHROME_EXECUTABLE ?? null,
        logLevel: "warn",
      });

      return chunkPath;
    });

    const chunkPaths = (await Promise.all(chunkPromises)).filter(
      (p): p is string => p !== null,
    );

    // Concat via ffmpeg
    const manifestPath = path.join(tmpDir, "manifest.txt");
    fs.writeFileSync(
      manifestPath,
      chunkPaths.map((p) => `file '${p}'`).join("\n"),
    );

    await ffmpeg(
      `-f concat -safe 0 -i "${manifestPath}" -c copy ` +
      `-movflags +faststart -loglevel error -y "${outputPath}"`,
    );

    onProgress?.(100);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
