import "dotenv/config";

// GitHub App
export const GITHUB_APP_ID = process.env.GITHUB_APP_ID || "";
export const GITHUB_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY || "";
export const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

// LLM provider — "openai" (default), "anthropic", or "vertex"
export const LLM_PROVIDER = process.env.LLM_PROVIDER || "openai";

// OpenAI (used for TTS always, and for analysis when LLM_PROVIDER=openai)
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Anthropic (used for analysis when LLM_PROVIDER=anthropic)
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

// Anthropic on Vertex AI (used for analysis when LLM_PROVIDER=vertex)
// Uses Google Cloud ADC — run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS
export const VERTEX_PROJECT = process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.VERTEX_PROJECT || "";
export const VERTEX_LOCATION = process.env.CLOUD_ML_REGION || process.env.VERTEX_LOCATION || "us-east5";
export const VERTEX_MODEL = process.env.VERTEX_MODEL || "claude-sonnet-4-20250514";

// Fast model — used for parallel file review batches (cheaper/faster model)
// Defaults to the main model if not set
export const LLM_FAST_MODEL = process.env.LLM_FAST_MODEL || "";

// TTS
export const TTS_VOICE = process.env.TTS_VOICE || "onyx";
export const TTS_SPEED = parseFloat(process.env.TTS_SPEED || "1.1");

// Cloudflare R2
export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
export const R2_BUCKET = process.env.R2_BUCKET || "preel-videos";
export const CDN_BASE_URL = process.env.CDN_BASE_URL || "";

// Server
export const PORT = parseInt(process.env.PORT || "3001", 10);
export const OUTPUT_DIR = process.env.OUTPUT_DIR || "./out";

// Render
export const RENDER_CONCURRENCY = parseInt(
  process.env.RENDER_CONCURRENCY || "4",
  10,
);
export const RENDER_CHUNKS = parseInt(
  process.env.RENDER_CHUNKS || "6",
  10,
);
export const SCENE_MAP_ENABLED =
  (process.env.SCENE_MAP_ENABLED ?? "true") !== "false";
export const CHROME_EXECUTABLE =
  process.env.REMOTION_CHROME_EXECUTABLE || undefined;
