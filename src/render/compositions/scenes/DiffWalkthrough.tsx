import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  COLORS,
  FONTS,
  SCROLL_PX_PER_FRAME,
  SCROLL_START_FRAME,
  springEntrance,
  slideIn,
  stagger,
} from "../styles";

interface DiffWalkthroughProps {
  filename: string;
  purpose: string;
  language: string;
  additions: number;
  deletions: number;
  highlightedHunks: { html: string }[];
  significance: "high" | "medium" | "low";
  fileIndex: number;
  totalFiles: number;
  durationInFrames: number;
}

export const DiffWalkthrough: React.FC<DiffWalkthroughProps> = ({
  filename,
  purpose,
  language,
  additions,
  deletions,
  highlightedHunks,
  fileIndex,
  totalFiles,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const header = slideIn(frame, fps, 0, "left");
  const purposeAnim = springEntrance(frame, fps, 6);
  const codeAnim = springEntrance(frame, fps, 12);

  // Estimate content height for auto-scroll
  const LINE_HEIGHT_PX = 30.6; // 18px font × 1.7 line-height
  const HUNK_MARGIN_PX = 16;
  const VIEWPORT_HEIGHT = 700; // approx code viewer visible area
  const totalLines = highlightedHunks.reduce((sum, h) => {
    // Count Shiki line spans, or fall back to newline count + 1
    const lineSpans = (h.html.match(/class="line"/g) || []).length;
    return sum + (lineSpans > 0 ? lineSpans : (h.html.match(/\n/g) || []).length + 1);
  }, 0);
  const contentHeight = totalLines * LINE_HEIGHT_PX + highlightedHunks.length * HUNK_MARGIN_PX;
  const scrollDistance = Math.max(0, contentHeight - VIEWPORT_HEIGHT);

  // Smooth scroll at fixed speed, starting after entrance settles
  const scrollFrames = scrollDistance > 0 ? Math.ceil(scrollDistance / SCROLL_PX_PER_FRAME) : 0;
  const SCROLL_END = SCROLL_START_FRAME + scrollFrames;
  const scrollY = scrollDistance > 0
    ? interpolate(frame, [SCROLL_START_FRAME, SCROLL_END], [0, -scrollDistance], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const parts = filename.split("/");
  const name = parts.pop()!;
  const dir = parts.join("/");

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: COLORS.bgTertiary,
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${((fileIndex + 1) / totalFiles) * 100}%`,
            background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.blue})`,
            transition: "width 0.3s",
          }}
        />
      </div>

      <div style={{ padding: "40px 60px", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* File header */}
        <div
          style={{
            opacity: header.opacity,
            transform: `translateX(${header.translateX}px)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: FONTS.mono,
              fontSize: 24,
            }}
          >
            <span
              style={{
                background: COLORS.accent,
                color: "#fff",
                padding: "2px 10px",
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {language}
            </span>
            {dir && (
              <span style={{ color: COLORS.textMuted }}>{dir}/</span>
            )}
            <span style={{ color: COLORS.text, fontWeight: 700 }}>{name}</span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              fontFamily: FONTS.mono,
              fontSize: 18,
            }}
          >
            <span style={{ color: COLORS.green }}>+{additions}</span>
            <span style={{ color: COLORS.red }}>−{deletions}</span>
            <span style={{ color: COLORS.textMuted }}>
              {fileIndex + 1}/{totalFiles}
            </span>
          </div>
        </div>

        {/* Purpose */}
        <div
          style={{
            opacity: purposeAnim.opacity,
            transform: `translateY(${purposeAnim.translateY}px)`,
            fontFamily: FONTS.sans,
            fontSize: 22,
            color: COLORS.textSecondary,
            marginBottom: 24,
            lineHeight: 1.4,
            maxWidth: 1200,
          }}
        >
          {purpose}
        </div>

        {/* Code viewer */}
        <div
          style={{
            opacity: codeAnim.opacity,
            transform: `translateY(${codeAnim.translateY}px)`,
            flex: 1,
            background: COLORS.bgSecondary,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Code header bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 20px",
              borderBottom: `1px solid ${COLORS.border}`,
              background: COLORS.bgTertiary,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: "#f85149",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: "#d29922",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: "#3fb950",
              }}
            />
            <span
              style={{
                marginLeft: 12,
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.textMuted,
              }}
            >
              {filename}
            </span>
          </div>

          {/* Code content */}
          <div
            style={{
              padding: "20px 24px",
              flex: 1,
              overflow: "hidden",
            }}
          >
            <div style={{ transform: `translateY(${scrollY}px)` }}>
            {highlightedHunks.map((hunk, i) => {
              const hunkAnim = springEntrance(
                frame,
                fps,
                stagger(i, 6) + 18,
              );
              return (
                <div
                  key={i}
                  style={{
                    opacity: hunkAnim.opacity,
                    transform: `translateY(${hunkAnim.translateY}px)`,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 18,
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                    dangerouslySetInnerHTML={{ __html: hunk.html }}
                  />
                </div>
              );
            })}

            {highlightedHunks.length === 0 && (
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 20,
                  color: COLORS.textMuted,
                  textAlign: "center",
                  paddingTop: 80,
                }}
              >
                Binary or generated file
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
