export type AgentMode = "simulate" | "external";

export type CodexSandboxMode = "workspace-write" | "danger-full-access" | "bypass";

export type Goal = {
  objective: string;
  deliverableType: string;
  targetUser?: string;
  workspace?: string;
  acceptanceCriteria: string[];
  constraints: string[];
  verificationCommands: string[];
  stopConditions: string[];
  manualApprovalCategories: string[];
  rawSections: Record<string, string>;
};

export type PlanResult = {
  summary: string;
  steps: string[];
  risks: string[];
};

export type FileChangeKind = "added" | "modified" | "deleted";

export type ObservedChange = {
  path: string;
  kind: FileChangeKind;
};

export type FindingResponseStatus = "fixed" | "rejected" | "unable";

export type FindingResponse = {
  findingId: string;
  status: FindingResponseStatus;
  note?: string;
};

export type BuilderResult = {
  summary: string;
  files: string[];
  notes: string[];
  reportedFiles?: string[];
  observedChanges?: ObservedChange[];
  discrepancies?: string[];
  findingResponses?: FindingResponse[];
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
  id: string;
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

export type PolicyDecision = "allow" | "deny" | "requiresApproval";

export type PolicyCheck = {
  command: string;
  decision: PolicyDecision;
  rule: string;
};

export type RunStatus = "passed" | "failed" | "stopped";

export type RunResult = {
  runId: string;
  runDir: string;
  mode: AgentMode;
  status: RunStatus;
  stopReason: string;
  workspaceRoot: string;
  warnings: string[];
  policyChecks: PolicyCheck[];
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
  workspaceOverride?: string;
  codexSandbox?: CodexSandboxMode;
};
