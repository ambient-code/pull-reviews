import { interpolate, spring } from "remotion";

export const COLORS = {
  bg: "#0d1117",
  bgSecondary: "#161b22",
  bgTertiary: "#21262d",
  text: "#e6edf3",
  textSecondary: "#8b949e",
  textMuted: "#484f58",
  border: "#30363d",
  green: "#3fb950",
  red: "#f85149",
  amber: "#d29922",
  blue: "#58a6ff",
  accent: "#7c3aed",
  accentDim: "#5b21b6",
} as const;

export const FONTS = {
  mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  sans: "'Inter', 'SF Pro Display', -apple-system, sans-serif",
} as const;

export const AUDIO_DELAY_FRAMES = 12;
export const FPS = 30;

/** Scroll speed for diff scenes (px per frame). ~150px/sec at 30fps. */
export const SCROLL_PX_PER_FRAME = 5;
/** Frame where scroll starts (after entrance animation settles). */
export const SCROLL_START_FRAME = 36;

export function getSceneDuration(
  fps: number,
  defaultSec: number,
  maxSec: number,
  audioDurationSec?: number,
  minSec?: number,
): number {
  const min = minSec ?? defaultSec * 0.5;
  if (audioDurationSec != null && audioDurationSec > 0) {
    // Audio drives duration: full audio + padding for delay + tail silence
    const withPadding = audioDurationSec + 1.5;
    return Math.round(Math.max(min, withPadding) * fps);
  }
  // No audio: use default, capped at max
  return Math.round(Math.min(defaultSec, maxSec) * fps);
}

export function springEntrance(
  frame: number,
  fps: number,
  delay = 0,
): { opacity: number; translateY: number } {
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
  });
  return {
    opacity: progress,
    translateY: interpolate(progress, [0, 1], [30, 0]),
  };
}

export function slideIn(
  frame: number,
  fps: number,
  delay = 0,
  direction: "left" | "right" = "left",
): { opacity: number; translateX: number } {
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 16, stiffness: 100, mass: 0.6 },
  });
  const from = direction === "left" ? -60 : 60;
  return {
    opacity: progress,
    translateX: interpolate(progress, [0, 1], [from, 0]),
  };
}

export function fadeIn(
  frame: number,
  fps: number,
  delay = 0,
  durationSec = 0.3,
): number {
  return interpolate(frame - delay, [0, durationSec * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function stagger(index: number, framesPerItem = 5): number {
  return index * framesPerItem;
}
