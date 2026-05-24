export type AgentMode = "simulate" | "external";

export type Goal = {
  objective: string;
  deliverableType: string;
  targetUser?: string;
  acceptanceCriteria: string[];
  constraints: string[];
  verificationCommands: string[];
  stopConditions: string[];
  rawSections: Record<string, string>;
};

export type PlanResult = {
  summary: string;
  steps: string[];
  risks: string[];
};

export type BuilderResult = {
  summary: string;
  files: string[];
  notes: string[];
};

export type EvaluationStatus = "pass" | "fail" | "skip";

export type EvaluationResult = {
  name: string;
  status: EvaluationStatus;
  summary: string;
  details?: string;
};

export type FindingSeverity = "blocking" | "warning" | "suggestion";

export type ReviewFinding = {
  severity: FindingSeverity;
  title: string;
  detail: string;
  suggestedAction: string;
};

export type ReviewResult = {
  summary: string;
  findings: ReviewFinding[];
};

export type IterationResult = {
  index: number;
  builder: BuilderResult;
  evaluations: EvaluationResult[];
  review: ReviewResult;
};

export type RunStatus = "passed" | "failed" | "stopped";

export type RunResult = {
  runId: string;
  runDir: string;
  mode: AgentMode;
  status: RunStatus;
  stopReason: string;
  goal: Goal;
  plan: PlanResult;
  iterations: IterationResult[];
};

export type RunOptions = {
  goalPath: string;
  mode: AgentMode;
  maxIterations: number;
  runVerificationCommands: boolean;
  cwd: string;
};

