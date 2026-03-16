import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  COLORS,
  FONTS,
  springEntrance,
  stagger,
} from "../styles";

interface FileEntry {
  filename: string;
  additions: number;
  deletions: number;
  significance: "high" | "medium" | "low";
  language: string;
}

interface FileOverviewProps {
  files: FileEntry[];
  totalFiles: number;
}

const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f7df1e",
  python: "#3572a5",
  rust: "#dea584",
  go: "#00add8",
  java: "#b07219",
  ruby: "#701516",
  css: "#563d7c",
  html: "#e34c26",
  json: "#292929",
  yaml: "#cb171e",
  markdown: "#083fa1",
  shell: "#89e051",
  sql: "#e38c00",
  swift: "#f05138",
  kotlin: "#a97bff",
  cpp: "#f34b7d",
  c: "#555555",
};

function getFileIcon(language: string): string {
  const icons: Record<string, string> = {
    typescript: "TS",
    javascript: "JS",
    python: "PY",
    rust: "RS",
    go: "GO",
    java: "JV",
    json: "{}",
    yaml: "YM",
    css: "CS",
    html: "<>",
    markdown: "MD",
    shell: "$_",
  };
  return icons[language] || "··";
}

function getBarWidth(additions: number, deletions: number, max: number): { addW: number; delW: number } {
  const total = additions + deletions;
  if (total === 0 || max === 0) return { addW: 0, delW: 0 };
  const scale = Math.min(1, total / max);
  const maxBarWidth = 240;
  const addW = (additions / total) * scale * maxBarWidth;
  const delW = (deletions / total) * scale * maxBarWidth;
  return { addW, delW };
}

export const FileOverview: React.FC<FileOverviewProps> = ({
  files,
  totalFiles,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const header = springEntrance(frame, fps, 0);
  const maxChanges = Math.max(...files.map((f) => f.additions + f.deletions), 1);
  const displayFiles = files.slice(0, 12);
  const remaining = totalFiles - displayFiles.length;

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
          fontFamily: FONTS.sans,
          fontSize: 36,
          fontWeight: 700,
          color: COLORS.text,
          marginBottom: 40,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span style={{ color: COLORS.accent }}>Files Changed</span>
        <span
          style={{
            background: COLORS.bgTertiary,
            padding: "4px 16px",
            borderRadius: 20,
            fontSize: 24,
            color: COLORS.textSecondary,
          }}
        >
          {totalFiles}
        </span>
      </div>

      {/* File list */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
        }}
      >
        {displayFiles.map((file, i) => {
          const anim = springEntrance(frame, fps, stagger(i, 4) + 8);
          const { addW, delW } = getBarWidth(file.additions, file.deletions, maxChanges);
          const langColor = LANG_COLORS[file.language] || COLORS.textMuted;
          const parts = file.filename.split("/");
          const name = parts.pop()!;
          const dir = parts.join("/");

          return (
            <div
              key={file.filename}
              style={{
                opacity: anim.opacity,
                transform: `translateY(${anim.translateY}px)`,
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "10px 20px",
                borderRadius: 8,
                background:
                  file.significance === "high"
                    ? `${COLORS.bgSecondary}`
                    : "transparent",
                borderLeft:
                  file.significance === "high"
                    ? `3px solid ${COLORS.accent}`
                    : "3px solid transparent",
              }}
            >
              {/* Language icon */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: `${langColor}22`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: FONTS.mono,
                  fontSize: 14,
                  fontWeight: 700,
                  color: langColor,
                  flexShrink: 0,
                }}
              >
                {getFileIcon(file.language)}
              </div>

              {/* Filename */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: FONTS.mono,
                  fontSize: 20,
                  display: "flex",
                  gap: 0,
                }}
              >
                {dir && (
                  <span style={{ color: COLORS.textMuted }}>{dir}/</span>
                )}
                <span style={{ color: COLORS.text, fontWeight: 600 }}>
                  {name}
                </span>
              </div>

              {/* Change bars */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 16,
                    color: COLORS.green,
                    width: 48,
                    textAlign: "right",
                  }}
                >
                  +{file.additions}
                </span>
                <div
                  style={{
                    display: "flex",
                    height: 8,
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: addW,
                      backgroundColor: COLORS.green,
                      borderRadius: "4px 0 0 4px",
                    }}
                  />
                  <div
                    style={{
                      width: delW,
                      backgroundColor: COLORS.red,
                      borderRadius: "0 4px 4px 0",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 16,
                    color: COLORS.red,
                    width: 48,
                  }}
                >
                  −{file.deletions}
                </span>
              </div>
            </div>
          );
        })}

        {remaining > 0 && (
          <div
            style={{
              opacity: springEntrance(frame, fps, stagger(displayFiles.length, 4) + 8).opacity,
              fontFamily: FONTS.mono,
              fontSize: 20,
              color: COLORS.textMuted,
              paddingLeft: 72,
              marginTop: 4,
            }}
          >
            and {remaining} more file{remaining !== 1 ? "s" : ""}…
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
