import type {
  PRContext,
  PRReviewData,
  NarrationScript,
  SceneScript,
} from "../types";
import type { ResolvedScenesConfig, ResolvedVideoConfig } from "../config/schema";

const WORDS_PER_SECOND = 2.8;

function estimateDuration(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(3, Math.ceil(words / WORDS_PER_SECOND));
}

export function generateScript(
  review: PRReviewData,
  ctx: PRContext,
  scenesConfig?: ResolvedScenesConfig,
  videoConfig?: ResolvedVideoConfig,
): NarrationScript {
  const scenes: SceneScript[] = [];
  const maxTotalSeconds = videoConfig?.duration.max ?? 90;
  const showTitleCard = scenesConfig?.title_card ?? true;
  const showFileOverview = scenesConfig?.file_overview ?? true;
  const showRiskCallout = scenesConfig?.risk_callout ?? true;
  const showSummary = scenesConfig?.summary ?? true;
  const diffConfig = scenesConfig?.diff_walkthrough ?? {
    enabled: true,
    max_files: 8,
    skip_significance: ["low"] as string[],
  };

  // Title scene
  if (showTitleCard) {
    const narrateStats = videoConfig?.narrate_stats ?? false;
    const titleText = narrateStats
      ? `Pull request ${ctx.prNumber}: ${ctx.prTitle}, by ${ctx.authorLogin}. ${review.stats.filesChanged} files changed, ${review.stats.totalAdditions} lines added, ${review.stats.totalDeletions} removed.`
      : `Pull request ${ctx.prNumber}: ${ctx.prTitle}, by ${ctx.authorLogin}.`;
    scenes.push({
      sceneId: "title",
      narrationText: titleText,
      estimatedSeconds: estimateDuration(titleText),
    });
  }

  // File overview scene
  if (showFileOverview) {
    const highFiles = review.fileReviews
      .filter((f) => f.significance === "high")
      .map((f) => f.filename.split("/").pop())
      .slice(0, 4);

    const overviewText =
      highFiles.length > 0
        ? `The main changes are in ${highFiles.join(", ")}. Let's walk through the key files.`
        : `This PR touches ${review.stats.filesChanged} files. Let's take a look.`;

    scenes.push({
      sceneId: "file-overview",
      narrationText: overviewText,
      estimatedSeconds: estimateDuration(overviewText),
    });
  }

  // Diff walkthrough scenes
  if (diffConfig.enabled) {
    let usedSeconds = scenes.reduce((s, sc) => s + sc.estimatedSeconds, 0) + 5;
    const riskReserve =
      showRiskCallout && review.risks.length > 0
        ? Math.min(8, 3 + review.risks.length * 2)
        : 0;
    usedSeconds += riskReserve;
    let diffBudget = maxTotalSeconds - usedSeconds;

    // Filter by significance
    const skipSig = diffConfig.skip_significance;
    const eligible = review.fileReviews.filter(
      (f) => !skipSig.includes(f.significance),
    );

    // Sort high first
    const sorted = [...eligible].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.significance] ?? 2) - (order[b.significance] ?? 2);
    });

    const maxFiles = diffConfig.max_files;
    for (let i = 0; i < sorted.length && i < maxFiles && diffBudget > 0; i++) {
      const file = sorted[i];
      const idx = review.fileReviews.indexOf(file);
      const est = estimateDuration(file.narration);

      if (est > diffBudget && i > 0) break;

      // Cap narration to ~20 words to keep scenes tight
      let narration = file.narration;
      const words = narration.split(/\s+/);
      if (words.length > 20) {
        narration = words.slice(0, 20).join(" ") + ".";
      }

      scenes.push({
        sceneId: `diff-${idx}`,
        narrationText: narration,
        estimatedSeconds: Math.min(estimateDuration(narration), 12),
      });

      diffBudget -= est;
    }
  }

  // Risk callout — narration is a brief summary, visual shows all risks
  if (showRiskCallout && review.risks.length > 0) {
    // Sort critical first, then warning, then info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const sorted = [...review.risks].sort(
      (a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2),
    );

    const criticalCount = sorted.filter((r) => r.severity === "critical").length;
    const warningCount = sorted.filter((r) => r.severity === "warning").length;

    // Brief spoken summary instead of reading each risk
    let riskText: string;
    if (criticalCount > 0) {
      riskText = `There are ${review.risks.length} items to watch, including ${criticalCount} critical. ${sorted[0].description.split(/[.!?]/)[0]}.`;
    } else if (warningCount > 0) {
      riskText = `${review.risks.length} things to keep in mind, ${warningCount} worth attention. ${sorted[0].description.split(/[.!?]/)[0]}.`;
    } else {
      riskText = `A few minor notes. ${review.risks.length} informational items flagged.`;
    }

    scenes.push({
      sceneId: "risk",
      narrationText: riskText,
      estimatedSeconds: estimateDuration(riskText),
    });
  }

  // Discussion scene — after risks, before summary
  const showDiscussion = scenesConfig?.discussion ?? true;
  if (showDiscussion && review.discussion?.hasDiscussion) {
    const narration = review.discussion.narration;
    scenes.push({
      sceneId: "discussion",
      narrationText: narration,
      estimatedSeconds: estimateDuration(narration),
    });
  }

  // Summary — cap to ~2 sentences
  if (showSummary) {
    let summaryText = review.summary;
    const sentences = summaryText.match(/[^.!?]+[.!?]+/g) ?? [summaryText];
    if (sentences.length > 2) {
      summaryText = sentences.slice(0, 2).join(" ").trim();
    }

    scenes.push({
      sceneId: "summary",
      narrationText: summaryText,
      estimatedSeconds: estimateDuration(summaryText),
    });
  }

  const totalEstimatedSeconds = scenes.reduce(
    (s, sc) => s + sc.estimatedSeconds,
    0,
  );

  return { scenes, totalEstimatedSeconds };
}
