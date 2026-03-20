import React from "react";
import {
  AbsoluteFill,
  Img,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONTS, springEntrance, slideIn } from "../styles";

interface TitleCardProps {
  prTitle: string;
  prNumber: number;
  authorLogin: string;
  authorAvatarUrl: string;
  repoFullName: string;
  baseBranch: string;
  headBranch: string;
  stats: {
    totalAdditions: number;
    totalDeletions: number;
    filesChanged: number;
    languages: string[];
  };
}

export const TitleCard: React.FC<TitleCardProps> = ({
  prTitle,
  prNumber,
  authorLogin,
  authorAvatarUrl,
  repoFullName,
  baseBranch,
  headBranch,
  stats,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const title = springEntrance(frame, fps, 0);
  const meta = springEntrance(frame, fps, 8);
  const branches = slideIn(frame, fps, 14, "left");
  const statsAnim = springEntrance(frame, fps, 20);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        padding: 80,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      {/* Accent line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.blue})`,
        }}
      />

      {/* Repo name */}
      <div
        style={{
          opacity: meta.opacity,
          transform: `translateY(${meta.translateY}px)`,
          fontFamily: FONTS.mono,
          fontSize: 28,
          color: COLORS.textSecondary,
          marginBottom: 16,
          letterSpacing: 1,
        }}
      >
        {repoFullName}
      </div>

      {/* PR title */}
      <div
        style={{
          opacity: title.opacity,
          transform: `translateY(${title.translateY}px)`,
          fontFamily: FONTS.sans,
          fontSize: 56,
          fontWeight: 700,
          color: COLORS.text,
          lineHeight: 1.2,
          marginBottom: 32,
          maxWidth: 1400,
        }}
      >
        #{prNumber} {prTitle}
      </div>

      {/* Author + branches */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          opacity: branches.opacity,
          transform: `translateX(${branches.translateX}px)`,
          marginBottom: 48,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Img
            src={authorAvatarUrl}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              border: `2px solid ${COLORS.border}`,
            }}
          />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 24,
              color: COLORS.text,
              fontWeight: 600,
            }}
          >
            {authorLogin}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: FONTS.mono,
            fontSize: 20,
            color: COLORS.textSecondary,
          }}
        >
          <span
            style={{
              background: COLORS.bgTertiary,
              padding: "4px 12px",
              borderRadius: 6,
              color: COLORS.blue,
            }}
          >
            {headBranch}
          </span>
          <span style={{ color: COLORS.textMuted }}>→</span>
          <span
            style={{
              background: COLORS.bgTertiary,
              padding: "4px 12px",
              borderRadius: 6,
              color: COLORS.text,
            }}
          >
            {baseBranch}
          </span>
        </div>
      </div>

      {/* Stats bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 32,
          opacity: statsAnim.opacity,
          transform: `translateY(${statsAnim.translateY}px)`,
          fontFamily: FONTS.mono,
          fontSize: 26,
        }}
      >
        <span style={{ color: COLORS.green, fontWeight: 700 }}>
          +{stats.totalAdditions}
        </span>
        <span style={{ color: COLORS.red, fontWeight: 700 }}>
          −{stats.totalDeletions}
        </span>
        <span style={{ color: COLORS.textSecondary }}>
          {stats.filesChanged} file{stats.filesChanged !== 1 ? "s" : ""}
        </span>
        {stats.languages.length > 0 && (
          <span style={{ color: COLORS.textMuted }}>
            {stats.languages.slice(0, 4).join(" · ")}
          </span>
        )}
      </div>

      {/* Brand */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          right: 60,
          fontFamily: FONTS.sans,
          fontSize: 20,
          color: COLORS.textMuted,
          letterSpacing: 2,
          fontWeight: 600,
        }}
      >
        PULL-REVIEWS
      </div>
    </AbsoluteFill>
  );
};
