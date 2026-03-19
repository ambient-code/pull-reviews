import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { parseBuffer } from "music-metadata";
import { OPENAI_API_KEY, OUTPUT_DIR } from "../config";
import type { NarrationScript, TTSResult } from "../types";
import type { ResolvedTTSConfig } from "../config/schema";
import { generateAllNarrationLocal } from "./piper";

const TTS_PROVIDER = process.env.TTS_PROVIDER || (OPENAI_API_KEY ? "openai" : "local");

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional:
    "Professional, calm, and informative. You are narrating a code review walkthrough for software developers. Speak clearly at a moderate pace. Be direct and concise. Do not sound overly enthusiastic or robotic.",
  casual:
    "Conversational and approachable. Like explaining code changes to a colleague over coffee. Keep it natural and relaxed but still informative.",
  technical:
    "Precise and technical. Use exact terminology. Assume deep familiarity with software engineering concepts. Be efficient with words.",
  friendly:
    "Warm and encouraging. Like a senior developer mentoring a newer team member. Be supportive while still being informative and clear.",
};

export async function generateAllNarration(
  jobId: string,
  script: NarrationScript,
  ttsConfig?: ResolvedTTSConfig,
): Promise<TTSResult> {
  if (TTS_PROVIDER === "local") {
    console.log("Using Kokoro (local) TTS");
    return generateAllNarrationLocal(jobId, script);
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const ttsDir = path.join(OUTPUT_DIR, "tts", jobId);
  fs.mkdirSync(ttsDir, { recursive: true });

  const voice = ttsConfig?.voice ?? "onyx";
  const speed = ttsConfig?.speed ?? 1.1;
  const tone = ttsConfig?.tone ?? "professional";
  const instructions = TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS.professional;

  console.log(`TTS config: voice=${voice}, speed=${speed}, tone=${tone}`);

  const audioFiles: Record<string, string> = {};
  const audioDurations: Record<string, number> = {};

  const results = await Promise.allSettled(
    script.scenes.map(async (scene) => {
      try {
        const response = await openai.audio.speech.create({
          model: "gpt-4o-mini-tts",
          voice: voice as "onyx",
          input: scene.narrationText,
          speed,
          instructions,
          response_format: "mp3",
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        const filePath = path.join(ttsDir, `${scene.sceneId}.mp3`);
        fs.writeFileSync(filePath, buffer);

        const metadata = await parseBuffer(buffer, {
          mimeType: "audio/mpeg",
        });
        const duration = metadata.format.duration ?? scene.estimatedSeconds;

        audioFiles[scene.sceneId] = filePath;
        audioDurations[scene.sceneId] = duration;

        console.log(
          `TTS: ${scene.sceneId} → ${duration.toFixed(1)}s (${buffer.length} bytes)`,
        );
      } catch (err) {
        console.error(`TTS failed for scene ${scene.sceneId}:`, err);
        audioDurations[scene.sceneId] = scene.estimatedSeconds;
      }
    }),
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.warn(
      `${failures.length}/${script.scenes.length} TTS scenes failed`,
    );
  }

  return { audioFiles, audioDurations };
}

export function cleanupTTS(jobId: string): void {
  const ttsDir = path.join(OUTPUT_DIR, "tts", jobId);
  try {
    fs.rmSync(ttsDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
