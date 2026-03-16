import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS, springEntrance, stagger } from "../styles";

interface DiscussionProps {
  toolsInvolved: string[];
  humanReviewers: string[];
  hasApproval: boolean;
  hasChangesRequested: boolean;
  concernsSummary: string;
  humanConcerns: string[];
  toolConcerns: string[];
}

const TOOL_COLORS: Record<string, string> = {
  CodeRabbit: "#FF6B35",
  Codex: "#10B981",
  Claude: "#D97706",
  Copilot: "#7C3AED",
  DeepSource: "#3B82F6",
  SonarCloud: "#EF4444",
  Snyk: "#8B5CF6",
  Codecov: "#F59E0B",
};

export const Discussion: React.FC<DiscussionProps> = ({
  toolsInvolved,
  humanReviewers,
  hasApproval,
  hasChangesRequested,
  concernsSummary,
  humanConcerns,
  toolConcerns,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const header = springEntrance(frame, fps, 0);
  const allConcerns = [
    ...humanConcerns.map((c) => ({ text: c, source: "human" as const })),
    ...toolConcerns.map((c) => ({ text: c, source: "tool" as const })),
  ];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        padding: "60px 80px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          opacity: header.opacity,
          transform: `translateY(${header.translateY}px)`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: `${COLORS.blue}20`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}
        >
          💬
        </div>
        <span
          style={{
            fontFamily: FONTS.sans,
            fontSize: 36,
            fontWeight: 700,
            color: COLORS.text,
          }}
        >
          Discussion
        </span>

        {/* Status badges */}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {hasApproval && (
            <span
              style={{
                background: `${COLORS.green}20`,
                color: COLORS.green,
                padding: "4px 16px",
                borderRadius: 20,
                fontFamily: FONTS.mono,
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              Approved
            </span>
          )}
          {hasChangesRequested && (
            <span
              style={{
                background: `${COLORS.amber}20`,
                color: COLORS.amber,
                padding: "4px 16px",
                borderRadius: 20,
                fontFamily: FONTS.mono,
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              Changes Requested
            </span>
          )}
        </div>
      </div>

      {/* Participants row */}
      <div
        style={{
          ...springEntrance(frame, fps, 5),
          display: "flex",
          gap: 24,
          marginBottom: 32,
        }}
      >
        {/* Human reviewers */}
        {humanReviewers.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.textMuted,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Reviewers
            </span>
            {humanReviewers.slice(0, 4).map((r) => (
              <span
                key={r}
                style={{
                  background: COLORS.bgTertiary,
                  padding: "4px 12px",
                  borderRadius: 16,
                  fontFamily: FONTS.mono,
                  fontSize: 16,
                  color: COLORS.text,
                }}
              >
                {r}
              </span>
            ))}
          </div>
        )}

        {/* Tools */}
        {toolsInvolved.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.textMuted,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Tools
            </span>
            {toolsInvolved.map((t) => (
              <span
                key={t}
                style={{
                  background: `${TOOL_COLORS[t] ?? COLORS.accent}20`,
                  color: TOOL_COLORS[t] ?? COLORS.accent,
                  padding: "4px 12px",
                  borderRadius: 16,
                  fontFamily: FONTS.mono,
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      {concernsSummary && (
        <div
          style={{
            ...springEntrance(frame, fps, 10),
            background: COLORS.bgSecondary,
            borderRadius: 12,
            padding: "20px 28px",
            marginBottom: 24,
            borderLeft: `4px solid ${COLORS.blue}`,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.sans,
              fontSize: 24,
              color: COLORS.text,
              lineHeight: 1.5,
            }}
          >
            {concernsSummary}
          </div>
        </div>
      )}

      {/* Concern items */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {allConcerns.slice(0, 6).map((concern, i) => {
          const anim = springEntrance(frame, fps, stagger(i, 5) + 15);
          const isHuman = concern.source === "human";
          const borderColor = isHuman ? COLORS.green : COLORS.accent;

          return (
            <div
              key={i}
              style={{
                opacity: anim.opacity,
                transform: `translateY(${anim.translateY}px)`,
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
                padding: "16px 24px",
                borderRadius: 10,
                background: `${borderColor}08`,
                borderLeft: `3px solid ${borderColor}`,
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  color: borderColor,
                  background: `${borderColor}20`,
                  padding: "2px 8px",
                  borderRadius: 4,
                  flexShrink: 0,
                  marginTop: 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontWeight: 700,
                }}
              >
                {isHuman ? "Human" : "Tool"}
              </span>
              <span
                style={{
                  fontFamily: FONTS.sans,
                  fontSize: 20,
                  color: COLORS.text,
                  lineHeight: 1.4,
                }}
              >
                {concern.text}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
