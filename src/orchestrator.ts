import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseGoalFile } from "./goal-parser.js";
import { SimulatedAgentAdapter } from "./adapters/simulated-agent-adapter.js";
import type { AgentAdapter, AgentContext } from "./adapters/agent-adapter.js";
import { evaluateArtifacts } from "./evaluators/artifact-evaluator.js";
import { evaluateCommands } from "./evaluators/command-evaluator.js";
import type {
  AgentMode,
  EvaluationResult,
  IterationResult,
  ReviewResult,
  RunOptions,
  RunResult,
  RunStatus
} from "./types.js";

export async function runGoal(options: RunOptions): Promise<RunResult> {
  const goal = await parseGoalFile(options.goalPath);
  const runId = createRunId();
  const runDir = resolve(options.cwd, "runs", runId);
  await mkdir(runDir, { recursive: true });

  await writeJson(join(runDir, "normalized-goal.json"), goal);

  const adapter = createAdapter(options.mode);
  const baseContext: AgentContext = {
    runDir,
    iteration: 0,
    previousEvaluations: []
  };

  const plan = await adapter.plan(goal, baseContext);
  await writeJson(join(runDir, "plan.json"), plan);
  await writeFile(join(runDir, "plan.md"), renderPlan(plan), "utf8");

  const iterations: IterationResult[] = [];
  let previousEvaluations: EvaluationResult[] = [];
  let previousReview: ReviewResult | undefined;
  let status: RunStatus = "stopped";
  let stopReason = "Maximum iterations reached.";

  for (let index = 1; index <= options.maxIterations; index += 1) {
    const context: AgentContext = {
      runDir,
      iteration: index,
      previousEvaluations,
      previousReview
    };

    const builder = await adapter.build(goal, plan, context);
    const evaluations = [
      ...(await evaluateArtifacts(goal, plan, builder)),
      ...(await evaluateCommands(goal.verificationCommands, options.cwd, options.runVerificationCommands))
    ];
    const review = await adapter.review(goal, plan, builder, evaluations, context);
    const iteration: IterationResult = { index, builder, evaluations, review };

    iterations.push(iteration);
    previousEvaluations = evaluations;
    previousReview = review;
    await writeJson(join(runDir, `iteration-${index}.json`), iteration);

    const blockingFindings = review.findings.filter((finding) => finding.severity === "blocking");
    const failedEvaluations = evaluations.filter((result) => result.status === "fail");

    if (failedEvaluations.length === 0 && blockingFindings.length === 0) {
      status = "passed";
      stopReason = "All evaluators passed and the reviewer found no blocking issues.";
      break;
    }

    if (hasRepeatedFailure(iterations)) {
      status = "failed";
      stopReason = "The same evaluator failed in consecutive iterations.";
      break;
    }
  }

  const result: RunResult = {
    runId,
    runDir,
    mode: options.mode,
    status,
    stopReason,
    goal,
    plan,
    iterations
  };

  await writeJson(join(runDir, "final-report.json"), result);
  await writeFile(join(runDir, "final-report.md"), renderFinalReport(result), "utf8");

  return result;
}

function createAdapter(mode: AgentMode): AgentAdapter {
  if (mode === "simulate") {
    return new SimulatedAgentAdapter();
  }

  throw new Error("External mode is not implemented yet. Use --mode simulate for the MVP.");
}

function createRunId(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderPlan(plan: { summary: string; steps: string[]; risks: string[] }): string {
  return [
    "# Plan",
    "",
    plan.summary,
    "",
    "## Steps",
    ...plan.steps.map((step) => `- ${step}`),
    "",
    "## Risks",
    ...plan.risks.map((risk) => `- ${risk}`)
  ].join("\n");
}

function renderFinalReport(result: RunResult): string {
  const lines = [
    "# Final Report",
    "",
    `Run ID: ${result.runId}`,
    `Mode: ${result.mode}`,
    `Status: ${result.status}`,
    `Stop reason: ${result.stopReason}`,
    "",
    "## Objective",
    "",
    result.goal.objective,
    "",
    "## Iterations"
  ];

  for (const iteration of result.iterations) {
    lines.push(
      "",
      `### Iteration ${iteration.index}`,
      "",
      `Builder: ${iteration.builder.summary}`,
      "",
      "Evaluations:",
      ...iteration.evaluations.map((evaluation) => `- ${evaluation.status}: ${evaluation.name} - ${evaluation.summary}`),
      "",
      `Review: ${iteration.review.summary}`,
      ...iteration.review.findings.map(
        (finding) => `- ${finding.severity}: ${finding.title} - ${finding.suggestedAction}`
      )
    );
  }

  return `${lines.join("\n")}\n`;
}

function hasRepeatedFailure(iterations: IterationResult[]): boolean {
  if (iterations.length < 2) {
    return false;
  }

  const latest = iterations.at(-1)?.evaluations.filter((result) => result.status === "fail").map((result) => result.name) ?? [];
  const previous =
    iterations.at(-2)?.evaluations.filter((result) => result.status === "fail").map((result) => result.name) ?? [];
  return latest.some((name) => previous.includes(name));
}

