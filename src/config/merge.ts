import type { PartialPreelConfig } from "./schema";
import { DEFAULT_CONFIG, type ResolvedPreelConfig } from "./schema";

/** Deep merge two partial configs. Overlay wins for scalars, arrays replace, objects recurse. */
export function deepMerge<T>(
  base: T,
  overlay: Partial<T> | undefined,
): T {
  if (!overlay) return base;

  const result = { ...base } as Record<string, unknown>;
  const baseRec = base as Record<string, unknown>;
  const overRec = overlay as Record<string, unknown>;

  for (const key of Object.keys(overRec)) {
    const baseVal = baseRec[key];
    const overVal = overRec[key];

    if (overVal === undefined) continue;
    if (overVal === null) continue; // null = revert to system default (handled at resolve)

    if (Array.isArray(overVal)) {
      // Arrays replace, not concatenate
      result[key] = [...overVal];
    } else if (
      typeof overVal === "object" &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal) &&
      baseVal !== null
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      );
    } else {
      result[key] = overVal;
    }
  }

  return result as T;
}

/** Apply a partial config over the fully resolved default config */
export function applyOverlay(
  base: ResolvedPreelConfig,
  overlay: PartialPreelConfig,
): ResolvedPreelConfig {
  const result = { ...base };

  if (overlay.review) {
    result.review = deepMerge(base.review, overlay.review as Partial<typeof base.review>);
  }

  if (overlay.scenes) {
    const s = overlay.scenes;
    result.scenes = { ...base.scenes };

    if (s.title_card !== undefined) result.scenes.title_card = s.title_card;
    if (s.file_overview !== undefined)
      result.scenes.file_overview = s.file_overview;
    if (s.risk_callout !== undefined)
      result.scenes.risk_callout = s.risk_callout;
    if (s.discussion !== undefined)
      result.scenes.discussion = s.discussion;
    if (s.summary !== undefined) result.scenes.summary = s.summary;

    if (s.diff_walkthrough !== undefined) {
      if (typeof s.diff_walkthrough === "boolean") {
        result.scenes.diff_walkthrough = {
          ...base.scenes.diff_walkthrough,
          enabled: s.diff_walkthrough,
        };
      } else {
        result.scenes.diff_walkthrough = deepMerge(
          base.scenes.diff_walkthrough,
          s.diff_walkthrough,
        );
      }
    }
  }

  if (overlay.tts) {
    result.tts = deepMerge(base.tts, overlay.tts);
  }

  if (overlay.video) {
    result.video = deepMerge(base.video, overlay.video as Partial<typeof base.video>);
  }

  if (overlay.filter) {
    result.filter = deepMerge(base.filter, overlay.filter);
  }

  if (overlay.comments) {
    result.comments = deepMerge(base.comments, overlay.comments);
  }

  return result;
}
