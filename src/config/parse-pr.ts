import { parse as parseYAML } from "yaml";
import { partialPreelConfigSchema, type PartialPreelConfig } from "./schema";

/** Extract preel config from PR body markers: <!-- preel ... --> */
export function parsePRBodyConfig(
  body: string | null | undefined,
): PartialPreelConfig | null {
  if (!body) return null;

  const match = body.match(/<!--\s*preel\s*\n([\s\S]*?)-->/);
  if (!match) return null;

  try {
    const raw = parseYAML(match[1]);
    if (!raw || typeof raw !== "object") return null;

    const result = partialPreelConfigSchema.safeParse(raw);
    if (!result.success) {
      console.warn("Invalid preel config in PR body:", result.error.message);
      return null;
    }

    return result.data;
  } catch (err) {
    console.warn("Failed to parse preel config from PR body:", err);
    return null;
  }
}
