import type {
  BuilderResult,
  EvaluationResult,
  Goal,
  PlanResult,
  ReviewResult
} from "../types.js";

export type AgentContext = {
  runDir: string;
  iteration: number;
  previousEvaluations: EvaluationResult[];
  previousReview?: ReviewResult;
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

