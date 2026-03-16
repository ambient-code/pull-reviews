import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import type { PRReviewProps } from "../../types";
import { AUDIO_DELAY_FRAMES, FONTS, getSceneDuration } from "./styles";
import { TitleCard } from "./scenes/TitleCard";
import { FileOverview } from "./scenes/FileOverview";
import { DiffWalkthrough } from "./scenes/DiffWalkthrough";
import { RiskCallout } from "./scenes/RiskCallout";
import { Discussion } from "./scenes/Discussion";
import { Summary } from "./scenes/Summary";

export const PRReview: React.FC<PRReviewProps> = (props) => {
  const { fps } = useVideoConfig();
  const durations = props.audioDurations ?? {};
  const rawAudioFiles = props.audioFiles ?? {};

  const showTitle = props.showTitleCard !== false;
  const showOverview = props.showFileOverview !== false;
  const showSummaryScene = props.showSummary !== false;

  // Resolve audio file paths — if it's a bare filename, use staticFile()
  const audioSrc = (sceneId: string): string | null => {
    const val = rawAudioFiles[sceneId];
    if (!val) return null;
    if (val.startsWith("http://") || val.startsWith("https://")) return val;
    return staticFile(val);
  };

  // Compute scene durations from audio
  const titleDuration = showTitle
    ? getSceneDuration(fps, 5, 8, durations["title"])
    : 0;
  const overviewDuration = showOverview
    ? getSceneDuration(fps, 5, 8, durations["file-overview"])
    : 0;

  const diffDurations = props.fileReviews.map((_, i) =>
    getSceneDuration(fps, 6, 12, durations[`diff-${i}`]),
  );

  const riskDuration =
    props.risks.length > 0
      ? getSceneDuration(fps, 5, 10, durations["risk"])
      : 0;

  const showDiscussion = props.showDiscussion !== false && props.discussion?.hasDiscussion;
  const discussionDuration = showDiscussion
    ? getSceneDuration(fps, 5, 10, durations["discussion"])
    : 0;

  const summaryDuration = showSummaryScene
    ? getSceneDuration(fps, 5, 8, durations["summary"])
    : 0;

  // Build sequence layout
  let offset = 0;
  const scenes: { from: number; duration: number; id: string }[] = [];

  if (showTitle) {
    scenes.push({ from: offset, duration: titleDuration, id: "title" });
    offset += titleDuration;
  }

  if (showOverview) {
    scenes.push({
      from: offset,
      duration: overviewDuration,
      id: "file-overview",
    });
    offset += overviewDuration;
  }

  props.fileReviews.forEach((_, i) => {
    scenes.push({ from: offset, duration: diffDurations[i], id: `diff-${i}` });
    offset += diffDurations[i];
  });

  if (riskDuration > 0) {
    scenes.push({ from: offset, duration: riskDuration, id: "risk" });
    offset += riskDuration;
  }

  if (discussionDuration > 0) {
    scenes.push({ from: offset, duration: discussionDuration, id: "discussion" });
    offset += discussionDuration;
  }

  if (showSummaryScene) {
    scenes.push({ from: offset, duration: summaryDuration, id: "summary" });
  }

  const findScene = (id: string) => scenes.find((s) => s.id === id);

  return (
    <AbsoluteFill style={{ fontFamily: FONTS.sans }}>
      {/* Title card */}
      {showTitle && findScene("title") && (
        <Sequence from={findScene("title")!.from} durationInFrames={titleDuration}>
          <TitleCard
            prTitle={props.prTitle}
            prNumber={props.prNumber}
            authorLogin={props.authorLogin}
            authorAvatarUrl={props.authorAvatarUrl}
            repoFullName={props.repoFullName}
            baseBranch={props.baseBranch}
            headBranch={props.headBranch}
            stats={props.stats}
          />
          {audioSrc("title") && (
            <Sequence from={AUDIO_DELAY_FRAMES}>
              <Audio src={audioSrc("title")!} />
            </Sequence>
          )}
        </Sequence>
      )}

      {/* File overview */}
      {showOverview && findScene("file-overview") && (
        <Sequence from={findScene("file-overview")!.from} durationInFrames={overviewDuration}>
          <FileOverview
            files={props.fileReviews.map((f) => ({
              filename: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              significance: f.significance,
              language: f.language,
            }))}
            totalFiles={props.stats.filesChanged}
          />
          {audioSrc("file-overview") && (
            <Sequence from={AUDIO_DELAY_FRAMES}>
              <Audio src={audioSrc("file-overview")!} />
            </Sequence>
          )}
        </Sequence>
      )}

      {/* Diff walkthroughs */}
      {props.fileReviews.map((file, i) => {
        const scene = findScene(`diff-${i}`);
        if (!scene) return null;
        return (
          <Sequence
            key={file.filename}
            from={scene.from}
            durationInFrames={scene.duration}
          >
            <DiffWalkthrough
              filename={file.filename}
              purpose={file.purpose}
              language={file.language}
              additions={file.additions}
              deletions={file.deletions}
              highlightedHunks={file.highlightedHunks}
              significance={file.significance}
              fileIndex={i}
              totalFiles={props.fileReviews.length}
              durationInFrames={scene.duration}
            />
            {audioSrc(`diff-${i}`) && (
              <Sequence from={AUDIO_DELAY_FRAMES}>
                <Audio src={audioSrc(`diff-${i}`)!} />
              </Sequence>
            )}
          </Sequence>
        );
      })}

      {/* Risk callouts */}
      {riskDuration > 0 && findScene("risk") && (
        <Sequence
          from={findScene("risk")!.from}
          durationInFrames={riskDuration}
        >
          <RiskCallout risks={props.risks} />
          {audioSrc("risk") && (
            <Sequence from={AUDIO_DELAY_FRAMES}>
              <Audio src={audioSrc("risk")!} />
            </Sequence>
          )}
        </Sequence>
      )}

      {/* Discussion */}
      {showDiscussion && props.discussion && findScene("discussion") && (
        <Sequence
          from={findScene("discussion")!.from}
          durationInFrames={discussionDuration}
        >
          <Discussion
            toolsInvolved={props.discussion.toolsInvolved}
            humanReviewers={props.discussion.humanReviewers}
            hasApproval={props.discussion.hasApproval}
            hasChangesRequested={props.discussion.hasChangesRequested}
            concernsSummary={props.discussion.concernsSummary}
            humanConcerns={props.discussion.humanConcerns}
            toolConcerns={props.discussion.toolConcerns}
          />
          {audioSrc("discussion") && (
            <Sequence from={AUDIO_DELAY_FRAMES}>
              <Audio src={audioSrc("discussion")!} />
            </Sequence>
          )}
        </Sequence>
      )}

      {/* Summary */}
      {showSummaryScene && findScene("summary") && (
        <Sequence
          from={findScene("summary")!.from}
          durationInFrames={summaryDuration}
        >
          <Summary
            summary={props.summary}
            overallSentiment={props.overallSentiment}
            stats={props.stats}
            risksCount={props.risks.length}
          />
          {audioSrc("summary") && (
            <Sequence from={AUDIO_DELAY_FRAMES}>
              <Audio src={audioSrc("summary")!} />
            </Sequence>
          )}
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
