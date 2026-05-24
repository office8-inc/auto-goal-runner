import { access } from "node:fs/promises";
import type { BuilderResult, EvaluationResult, Goal, PlanResult } from "../types.js";

export async function evaluateArtifacts(
  goal: Goal,
  plan: PlanResult,
  builder: BuilderResult
): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];

  results.push({
    name: "plan-produced",
    status: plan.steps.length > 0 ? "pass" : "fail",
    summary: plan.steps.length > 0 ? "Plan includes executable steps." : "Plan did not include steps."
  });

  results.push({
    name: "builder-created-files",
    status: builder.files.length > 0 ? "pass" : "fail",
    summary:
      builder.files.length > 0
        ? `Builder created ${builder.files.length} file(s).`
        : "Builder did not report created files."
  });

  for (const file of builder.files) {
    results.push(await fileExistsResult(file));
  }

  results.push({
    name: "acceptance-criteria-present",
    status: goal.acceptanceCriteria.length > 0 ? "pass" : "fail",
    summary:
      goal.acceptanceCriteria.length > 0
        ? `Goal includes ${goal.acceptanceCriteria.length} acceptance criteria.`
        : "Goal does not include acceptance criteria."
  });

  return results;
}

async function fileExistsResult(file: string): Promise<EvaluationResult> {
  try {
    await access(file);
    return {
      name: `file-exists:${shortName(file)}`,
      status: "pass",
      summary: `File exists: ${file}`
    };
  } catch {
    return {
      name: `file-exists:${shortName(file)}`,
      status: "fail",
      summary: `Expected file is missing: ${file}`
    };
  }
}

function shortName(path: string): string {
  return path.replace(/\\/g, "/").split("/").slice(-2).join("/");
}

