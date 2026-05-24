import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAdapter, AgentContext } from "./agent-adapter.js";
import type {
  BuilderResult,
  EvaluationResult,
  Goal,
  PlanResult,
  ReviewFinding,
  ReviewResult
} from "../types.js";

export class SimulatedAgentAdapter implements AgentAdapter {
  async plan(goal: Goal): Promise<PlanResult> {
    const steps = [
      "Normalize the goal into acceptance criteria and constraints.",
      "Create a contained artifact inside the run directory.",
      "Run deterministic evaluators before subjective review.",
      "Use review findings as repair instructions for the next iteration.",
      "Stop when all evaluators pass or a configured stop condition is reached."
    ];

    return {
      summary: `Simulated Claude planner normalized a ${goal.deliverableType} goal.`,
      steps,
      risks: [
        "A broad goal can produce vague acceptance criteria.",
        "Subjective review must not replace deterministic checks.",
        "External agent mode needs stricter policy gates than simulate mode."
      ]
    };
  }

  async build(goal: Goal, plan: PlanResult, context: AgentContext): Promise<BuilderResult> {
    const artifactDir = join(context.runDir, "artifact");
    await mkdir(artifactDir, { recursive: true });

    const htmlPath = join(artifactDir, "index.html");
    const reportPath = join(context.runDir, `codex-build-${context.iteration}.md`);

    await writeFile(htmlPath, renderHtml(goal, plan, context.iteration), "utf8");
    await writeFile(
      reportPath,
      [
        `# Simulated Codex Build ${context.iteration}`,
        "",
        `Objective: ${goal.objective}`,
        "",
        "## Files",
        `- ${relativeName(htmlPath)}`,
        "",
        "## Notes",
        "- This pass used the local simulated adapter.",
        "- Real Codex integration should replace this adapter with a structured `codex exec --json` runner."
      ].join("\n"),
      "utf8"
    );

    return {
      summary: `Simulated Codex builder created a contained ${goal.deliverableType} artifact.`,
      files: [htmlPath, reportPath],
      notes: [
        "Generated artifact is intentionally local to the run directory.",
        context.iteration > 1
          ? "This iteration incorporated prior review context."
          : "This is the first builder pass."
      ]
    };
  }

  async review(
    goal: Goal,
    _plan: PlanResult,
    builder: BuilderResult,
    evaluations: EvaluationResult[]
  ): Promise<ReviewResult> {
    const failing = evaluations.filter((result) => result.status === "fail");
    const findings: ReviewFinding[] = failing.map((result) => ({
      severity: "blocking",
      title: `Evaluator failed: ${result.name}`,
      detail: result.summary,
      suggestedAction: "Repair the artifact or goal interpretation until this evaluator passes."
    }));

    findings.push({
      severity: "suggestion",
      title: "Make the next loop more measurable",
      detail: `The build created ${builder.files.length} file(s). Future runs should attach stronger domain-specific evaluators for ${goal.deliverableType}.`,
      suggestedAction: "Add a deliverable-specific evaluator such as Playwright, screenshot checks, or API tests."
    });

    return {
      summary:
        failing.length === 0
          ? "Simulated Claude reviewer found no blocking issues."
          : `Simulated Claude reviewer found ${failing.length} blocking issue(s).`,
      findings
    };
  }
}

function renderHtml(goal: Goal, plan: PlanResult, iteration: number): string {
  const criteria = goal.acceptanceCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");
  const steps = plan.steps.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Auto Goal Runner Artifact</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1f2937; }
      main { max-width: 920px; margin: 0 auto; padding: 40px 20px; }
      section { background: white; border: 1px solid #d9dee7; border-radius: 8px; padding: 24px; margin: 16px 0; }
      h1, h2 { line-height: 1.2; }
      .badge { display: inline-block; padding: 4px 8px; border-radius: 999px; background: #e6f4ea; color: #14532d; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <p class="badge">Iteration ${iteration}</p>
      <h1>${escapeHtml(goal.objective)}</h1>
      <section>
        <h2>Deliverable</h2>
        <p>${escapeHtml(goal.deliverableType)}</p>
      </section>
      <section>
        <h2>Acceptance Criteria</h2>
        <ul>${criteria}</ul>
      </section>
      <section>
        <h2>Loop Plan</h2>
        <ol>${steps}</ol>
      </section>
    </main>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativeName(path: string): string {
  return path.replace(/\\/g, "/").split("/").slice(-2).join("/");
}

