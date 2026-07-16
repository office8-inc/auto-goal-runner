import type {
  BuilderResult,
  CodexSandboxMode,
  EvaluationResult,
  Goal,
  PlanResult,
  ReviewResult
} from "../types.js";

export type AgentContext = {
  runDir: string;
  workspaceRoot: string;
  iteration: number;
  codexSandbox: CodexSandboxMode;
  previousEvaluations: EvaluationResult[];
  previousReview?: ReviewResult;
  previousBuilder?: BuilderResult;
};

export interface AgentAdapter {
  plan(goal: Goal, context: AgentContext): Promise<PlanResult>;
  build(goal: Goal, plan: PlanResult, context: AgentContext): Promise<BuilderResult>;
  review(
    goal: Goal,
    plan: PlanResult,
    builder: BuilderResult,
    evaluations: EvaluationResult[],
    context: AgentContext
  ): Promise<ReviewResult>;
}
