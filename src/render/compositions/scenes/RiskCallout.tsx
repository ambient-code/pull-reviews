import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS, springEntrance, stagger } from "../styles";

interface Risk {
  severity: "critical" | "warning" | "info";
  category: string;
  description: string;
}

interface RiskCalloutProps {
  risks: Risk[];
}

const SEVERITY_CONFIG: Record<
  string,
  { color: string; bg: string; label: string; icon: string }
> = {
  critical: {
    color: COLORS.red,
    bg: `${COLORS.red}15`,
    label: "CRITICAL",
    icon: "⊘",
  },
  warning: {
    color: COLORS.amber,
    bg: `${COLORS.amber}15`,
    label: "WARNING",
    icon: "△",
  },
  info: {
    color: COLORS.blue,
    bg: `${COLORS.blue}15`,
    label: "INFO",
    icon: "ℹ",
  },
};

export const RiskCallout: React.FC<RiskCalloutProps> = ({ risks }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const header = springEntrance(frame, fps, 0);

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
          marginBottom: 48,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: `${COLORS.amber}20`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}
        >
          △
        </div>
        <span
          style={{
            fontFamily: FONTS.sans,
            fontSize: 36,
            fontWeight: 700,
            color: COLORS.text,
          }}
        >
          Heads Up
        </span>
        <span
          style={{
            background: COLORS.bgTertiary,
            padding: "4px 16px",
            borderRadius: 20,
            fontFamily: FONTS.mono,
            fontSize: 22,
            color: COLORS.textSecondary,
          }}
        >
          {risks.length}
        </span>
      </div>

      {/* Risk items */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {risks.slice(0, 6).map((risk, i) => {
          const anim = springEntrance(frame, fps, stagger(i, 6) + 8);
          const config = SEVERITY_CONFIG[risk.severity] || SEVERITY_CONFIG.info;

          return (
            <div
              key={i}
              style={{
                opacity: anim.opacity,
                transform: `translateY(${anim.translateY}px)`,
                display: "flex",
                alignItems: "flex-start",
                gap: 20,
                padding: "20px 28px",
                borderRadius: 12,
                background: config.bg,
                borderLeft: `4px solid ${config.color}`,
              }}
            >
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 22,
                  color: config.color,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                {config.icon}
              </div>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 13,
                      fontWeight: 700,
                      color: config.color,
                      background: `${config.color}20`,
                      padding: "2px 8px",
                      borderRadius: 4,
                      letterSpacing: 1,
                    }}
                  >
                    {config.label}
                  </span>
                  <span
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 15,
                      color: COLORS.textMuted,
                      textTransform: "capitalize",
                    }}
                  >
                    {risk.category.replace("-", " ")}
                  </span>
                </div>

                <div
                  style={{
                    fontFamily: FONTS.sans,
                    fontSize: 22,
                    color: COLORS.text,
                    lineHeight: 1.4,
                  }}
                >
                  {risk.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
