import type { Octokit } from "@octokit/rest";
import picomatch from "picomatch";
import type { FileDiff, DiffHunk, DiffLine } from "../types";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  css: "css",
  scss: "css",
  html: "html",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  cpp: "cpp",
  c: "c",
  h: "c",
  toml: "toml",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
  php: "php",
  dart: "dart",
  zig: "zig",
};

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "text";
}

function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split("\n");
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
    if (hunkHeader) {
      current = { header: line, lines: [] };
      hunks.push(current);
      oldLine = parseInt(hunkHeader[1], 10);
      newLine = parseInt(hunkHeader[2], 10);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("+")) {
      current.lines.push({
        type: "add",
        content: line.slice(1),
        newLineNumber: newLine++,
      });
    } else if (line.startsWith("-")) {
      current.lines.push({
        type: "remove",
        content: line.slice(1),
        oldLineNumber: oldLine++,
      });
    } else if (line.startsWith(" ") || line === "") {
      current.lines.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      });
    }
  }

  return hunks;
}

export async function fetchPRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  ignorePatterns?: string[],
): Promise<FileDiff[]> {
  // Fetch file list with per-file stats and patches
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const diffs: FileDiff[] = files.map((file) => {
    const hunks = file.patch ? parseUnifiedDiff(file.patch) : [];
    const status =
      file.status === "added"
        ? "added"
        : file.status === "removed"
          ? "removed"
          : file.status === "renamed"
            ? "renamed"
            : "modified";

    return {
      filename: file.filename,
      status,
      additions: file.additions,
      deletions: file.deletions,
      language: detectLanguage(file.filename),
      hunks,
      oldFilename:
        file.status === "renamed" ? file.previous_filename : undefined,
    };
  });

  // Filter out ignored files
  if (ignorePatterns && ignorePatterns.length > 0) {
    const isIgnored = picomatch(ignorePatterns);
    return diffs.filter((d) => !isIgnored(d.filename));
  }

  return diffs;
}

/** Build a unified diff string for sending to Claude */
export function buildDiffText(diffs: FileDiff[], maxChars = 100_000): string {
  let text = "";

  for (const file of diffs) {
    const header = `\n--- ${file.oldFilename || file.filename}\n+++ ${file.filename}\n`;
    const hunkText = file.hunks
      .map((h) => {
        const lines = h.lines
          .map((l) => {
            const prefix =
              l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
            return `${prefix}${l.content}`;
          })
          .join("\n");
        return `${h.header}\n${lines}`;
      })
      .join("\n");

    const fileText = header + hunkText + "\n";

    if (text.length + fileText.length > maxChars) {
      text += `\n... (diff truncated, ${diffs.length - diffs.indexOf(file)} files omitted)\n`;
      break;
    }

    text += fileText;
  }

  return text;
}
