/**
 * Local TTS using Kokoro — free, high-quality, no API keys needed.
 * Uses kokoro-tts CLI (pip install kokoro-tts) with ONNX runtime.
 * Outputs WAV files which are converted to MP3 via ffmpeg.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parseBuffer } from "music-metadata";
import { OUTPUT_DIR } from "../config";
import type { NarrationScript, TTSResult } from "../types";

// Check multiple locations for cached model files
const CACHE_CANDIDATES = [
  path.resolve("/app/.kokoro-cache"),        // Docker pre-cached
  path.join(OUTPUT_DIR, ".kokoro-cache"),     // Local/CI fallback
];
const MODEL_URL = "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx";
const VOICES_URL = "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin";

function getModelDir(): string {
  for (const dir of CACHE_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "kokoro-v1.0.onnx"))) return dir;
  }
  // Fall back to OUTPUT_DIR cache and download
  return path.join(OUTPUT_DIR, ".kokoro-cache");
}

function ensureKokoro(): string {
  // Install kokoro-tts if not present
  try {
    execSync("kokoro-tts --help", { stdio: "pipe" });
  } catch {
    console.log("Installing kokoro-tts...");
    execSync("pip install --break-system-packages kokoro-tts", { stdio: "pipe" });
  }

  const modelDir = getModelDir();
  fs.mkdirSync(modelDir, { recursive: true });
  const modelPath = path.join(modelDir, "kokoro-v1.0.onnx");
  const voicesPath = path.join(modelDir, "voices-v1.0.bin");

  if (!fs.existsSync(modelPath)) {
    console.log("Downloading Kokoro model...");
    execSync(`curl -sL "${MODEL_URL}" -o "${modelPath}"`, { stdio: "pipe" });
  }
  if (!fs.existsSync(voicesPath)) {
    console.log("Downloading Kokoro voices...");
    execSync(`curl -sL "${VOICES_URL}" -o "${voicesPath}"`, { stdio: "pipe" });
  }

  return modelDir;
}

function wavToMp3(wavPath: string, mp3Path: string): void {
  execSync(`ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -q:a 4 "${mp3Path}" 2>/dev/null`, {
    stdio: "pipe",
  });
}

export async function generateAllNarrationLocal(
  jobId: string,
  script: NarrationScript,
): Promise<TTSResult> {
  const modelDir = ensureKokoro();

  const ttsDir = path.join(OUTPUT_DIR, "tts", jobId);
  fs.mkdirSync(ttsDir, { recursive: true });

  console.log(`Kokoro TTS: ${script.scenes.length} scenes`);

  const audioFiles: Record<string, string> = {};
  const audioDurations: Record<string, number> = {};

  for (const scene of script.scenes) {
    try {
      const textPath = path.resolve(ttsDir, `${scene.sceneId}.txt`);
      const wavPath = path.resolve(ttsDir, `${scene.sceneId}.wav`);
      const mp3Path = path.resolve(ttsDir, `${scene.sceneId}.mp3`);

      // Write narration text to file
      fs.writeFileSync(textPath, scene.narrationText);

      // Run kokoro-tts from the model directory so it finds the model files
      execSync(
        `kokoro-tts "${textPath}" "${wavPath}" --voice af_sarah --speed 1.1 --lang en-us`,
        { cwd: modelDir, stdio: "pipe", timeout: 60000 },
      );

      // Convert to mp3
      wavToMp3(wavPath, mp3Path);
      fs.unlinkSync(wavPath);
      fs.unlinkSync(textPath);

      const buffer = fs.readFileSync(mp3Path);
      const metadata = await parseBuffer(buffer, { mimeType: "audio/mpeg" });
      const duration = metadata.format.duration ?? scene.estimatedSeconds;

      audioFiles[scene.sceneId] = mp3Path;
      audioDurations[scene.sceneId] = duration;

      console.log(`  Kokoro: ${scene.sceneId} → ${duration.toFixed(1)}s`);
    } catch (err) {
      console.error(`Kokoro TTS failed for scene ${scene.sceneId}:`, err);
      audioDurations[scene.sceneId] = scene.estimatedSeconds;
    }
  }

  return { audioFiles, audioDurations };
}
