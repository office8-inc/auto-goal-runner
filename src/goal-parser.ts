import { readFile } from "node:fs/promises";
import type { Goal } from "./types.js";

const SECTION_ALIASES: Record<string, keyof Omit<Goal, "rawSections">> = {
  objective: "objective",
  "deliverable type": "deliverableType",
  "target user": "targetUser",
  "acceptance criteria": "acceptanceCriteria",
  constraints: "constraints",
  "verification commands": "verificationCommands",
  "stop conditions": "stopConditions"
};

export async function parseGoalFile(path: string): Promise<Goal> {
  const markdown = await readFile(path, "utf8");
  return parseGoalMarkdown(markdown);
}

export function parseGoalMarkdown(markdown: string): Goal {
  const rawSections = splitSections(markdown);
  const get = (key: string) => rawSections[key.toLowerCase()] ?? "";

  const objective = firstParagraph(get("objective"));
  const deliverableType = firstParagraph(get("deliverable type")) || "custom";

  if (!objective) {
    throw new Error("GOAL.md must include a non-empty '## Objective' section.");
  }

  return {
    objective,
    deliverableType,
    targetUser: firstParagraph(get("target user")) || undefined,
    acceptanceCriteria: parseList(get("acceptance criteria")),
    constraints: parseList(get("constraints")),
    verificationCommands: parseList(get("verification commands")),
    stopConditions: parseList(get("stop conditions")),
    rawSections
  };
}

function splitSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | undefined;
  const buffer: string[] = [];

  const flush = () => {
    if (current) {
      sections[current] = buffer.join("\n").trim();
      buffer.length = 0;
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      current = normalizeHeading(match[1]);
      continue;
    }

    if (current) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

function normalizeHeading(heading: string): string {
  const normalized = heading.trim().toLowerCase();
  return SECTION_ALIASES[normalized] ? normalized : normalized;
}

function firstParagraph(value: string): string {
  return value
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^[-*]\s+/gm, "").trim())
    .find(Boolean) ?? "";
}

function parseList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

