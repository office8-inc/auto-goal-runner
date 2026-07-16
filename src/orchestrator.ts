import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseGoalFile } from "./goal-parser.js";
import { SimulatedAgentAdapter } from "./adapters/simulated-agent-adapter.js";
import { ExternalAgentAdapter } from "./adapters/external-agent-adapter.js";
import type { AgentAdapter, AgentContext } from "./adapters/agent-adapter.js";
import { evaluateArtifacts } from "./evaluators/artifact-evaluator.js";
import { evaluateCommands } from "./evaluators/command-evaluator.js";
import { checkCommandPolicies } from "./policy.js";
import {
  applyObservation,
  captureWorkspaceSnapshot,
  diffWorkspaceSnapshots,
  reconcileChanges,
  resolveWorkspaceRoot
} from "./workspace.js";
import type {
  AgentMode,
  BuilderResult,
  EvaluationResult,
  Goal,
  IterationResult,
  PlanResult,
  PolicyCheck,
  ReviewResult,
  RunOptions,
  RunResult,
  RunStatus
} from "./types.js";

export async function runGoal(options: RunOptions): Promise<RunResult> {
  const goal = await parseGoalFile(options.goalPath);
  const workspaceRoot = resolveWorkspaceRoot(goal, options);
  const runId = createRunId();
  const runDir = resolve(options.cwd, "runs", runId);
  await mkdir(runDir, { recursive: true });

  await writeJson(join(runDir, "normalized-goal.json"), goal);

  const policyChecks = checkCommandPolicies(goal.verificationCommands, goal);
  await writeJson(join(runDir, "policy-checks.json"), policyChecks);

  const gatedChecks = policyChecks.filter((check) => check.decision !== "allow");
  if (options.runVerificationCommands && gatedChecks.length > 0) {
    return finalizeRun({
      runId,
      runDir,
      mode: options.mode,
      status: "stopped",
      stopReason: `A policy-gated action is required. Gated commands: ${gatedChecks
        .map((check) => `"${check.command}" (${check.rule})`)
        .join(", ")}`,
      workspaceRoot,
      policyChecks,
      goal,
      plan: { summary: "Run stopped by the command policy before planning.", steps: [], risks: [] },
      iterations: []
    });
  }

  const adapter = createAdapter(options.mode);
  const baseContext: AgentContext = {
    runDir,
    workspaceRoot,
    iteration: 0,
    codexSandbox: options.codexSandbox ?? "workspace-write",
    previousEvaluations: []
  };

  const plan = await adapter.plan(goal, baseContext);
  await writeJson(join(runDir, "plan.json"), plan);
  await writeFile(join(runDir, "plan.md"), renderPlan(plan), "utf8");

  const iterations: IterationResult[] = [];
  let previousEvaluations: EvaluationResult[] = [];
  let previousReview: ReviewResult | undefined;
  let previousBuilder: BuilderResult | undefined;
  let status: RunStatus = "stopped";
  let stopReason = "Maximum iterations reached.";

  for (let index = 1; index <= options.maxIterations; index += 1) {
    const context: AgentContext = {
      runDir,
      workspaceRoot,
      iteration: index,
      codexSandbox: baseContext.codexSandbox,
      previousEvaluations,
      previousReview,
      previousBuilder
    };

    const beforeSnapshot = captureWorkspaceSnapshot(workspaceRoot);
    const rawBuilder = await adapter.build(goal, plan, context);
    const afterSnapshot = captureWorkspaceSnapshot(workspaceRoot);

    const observation = reconcileChanges({
      workspaceRoot,
      runDir,
      reportedFiles: rawBuilder.reportedFiles ?? rawBuilder.files,
      observedChanges: diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot),
      snapshotTruncated: beforeSnapshot.truncated || afterSnapshot.truncated,
      snapshotUnreadableDirs: [...new Set([...beforeSnapshot.unreadableDirs, ...afterSnapshot.unreadableDirs])]
    });
    const builder = applyObservation(rawBuilder, observation);

    const evaluations = [
      ...(await evaluateArtifacts(goal, plan, builder)),
      ...(await evaluateCommands(
        goal.verificationCommands,
        workspaceRoot,
        options.runVerificationCommands,
        runDir
      ))
    ];
    const review = await adapter.review(goal, plan, builder, evaluations, context);
    const iteration: IterationResult = { index, builder, evaluations, review };

    iterations.push(iteration);
    previousEvaluations = evaluations;
    previousReview = review;
    previousBuilder = builder;
    await writeJson(join(runDir, `iteration-${index}.json`), iteration);

    const outcome = resolveIterationOutcome(evaluations, review, options.mode);
    if (outcome) {
      status = outcome.status;
      stopReason = outcome.stopReason;
      break;
    }

    if (hasRepeatedFailure(iterations)) {
      status = "failed";
      stopReason = "The same evaluator failed in consecutive iterations.";
      break;
    }
  }

  if (status === "stopped" && stopReason === "Maximum iterations reached.") {
    const latest = iterations.at(-1);
    const hasFailedEvaluation = latest?.evaluations.some((result) => result.status === "fail") ?? false;
    const hasBlockingFinding = latest?.review.findings.some((finding) => finding.severity === "blocking") ?? false;
    if (hasFailedEvaluation || hasBlockingFinding) {
      status = "failed";
      stopReason = "Maximum iterations reached with failing evaluators or blocking review findings.";
    }
  }

  return finalizeRun({
    runId,
    runDir,
    mode: options.mode,
    status,
    stopReason,
    workspaceRoot,
    policyChecks,
    goal,
    plan,
    iterations
  });
}

/**
 * Pass/stop decision for one iteration. In external mode, skipped verification
 * commands mean the run is unverified and must not be reported as passed.
 */
export function resolveIterationOutcome(
  evaluations: EvaluationResult[],
  review: ReviewResult,
  mode: AgentMode
): { status: RunStatus; stopReason: string } | undefined {
  const failedEvaluations = evaluations.filter((result) => result.status === "fail");
  const blockingFindings = review.findings.filter((finding) => finding.severity === "blocking");

  if (failedEvaluations.length > 0 || blockingFindings.length > 0) {
    return undefined;
  }

  const skippedCommands = evaluations.filter(
    (result) => result.status === "skip" && result.name.startsWith("command:")
  );
  if (mode === "external" && skippedCommands.length > 0) {
    return {
      status: "stopped",
      stopReason:
        "All checks passed but verification commands were skipped. Re-run with --run-verification-commands to verify."
    };
  }

  return {
    status: "passed",
    stopReason: "All evaluators passed and the reviewer found no blocking issues."
  };
}

async function finalizeRun(result: RunResult): Promise<RunResult> {
  await writeJson(join(result.runDir, "final-report.json"), result);
  await writeFile(join(result.runDir, "final-report.md"), renderFinalReport(result), "utf8");
  return result;
}

function createAdapter(mode: AgentMode): AgentAdapter {
  if (mode === "simulate") {
    return new SimulatedAgentAdapter();
  }

  return new ExternalAgentAdapter();
}

function createRunId(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderPlan(plan: PlanResult): string {
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
    `Workspace: ${result.workspaceRoot}`,
    "",
    "## Objective",
    "",
    result.goal.objective,
    "",
    "## Policy Checks",
    ...(result.policyChecks.length > 0
      ? result.policyChecks.map((check) => `- ${check.decision}: ${check.command} (${check.rule})`)
      : ["- (no verification commands)"]),
    "",
    "## Iterations"
  ];

  for (const iteration of result.iterations) {
    lines.push(
      "",
      `### Iteration ${iteration.index}`,
      "",
      `Builder: ${iteration.builder.summary}`
    );

    if (iteration.builder.discrepancies?.length) {
      lines.push(
        "",
        "Discrepancies:",
        ...iteration.builder.discrepancies.map((item) => `- ${item}`)
      );
    }

    if (iteration.builder.findingResponses?.length) {
      lines.push(
        "",
        "Finding responses:",
        ...iteration.builder.findingResponses.map(
          (response) =>
            `- ${response.findingId}: ${response.status}${response.note ? ` - ${response.note}` : ""}`
        )
      );
    }

    lines.push(
      "",
      "Evaluations:",
      ...iteration.evaluations.map((evaluation) => `- ${evaluation.status}: ${evaluation.name} - ${evaluation.summary}`),
      "",
      `Review: ${iteration.review.summary}`,
      ...iteration.review.findings.map(
        (finding) => `- ${finding.severity} [${finding.id}]: ${finding.title} - ${finding.suggestedAction}`
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
