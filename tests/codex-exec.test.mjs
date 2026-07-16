import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexArgs, parseCodexLastMessage, renderBuildPrompt } from "../dist/adapters/codex-exec.js";

test("buildCodexArgs maps sandbox modes and structured output flags", () => {
  const base = {
    workspaceRoot: "C:/ws",
    schemaPath: "C:/runs/schema.json",
    lastMessagePath: "C:/runs/last.json"
  };

  const writable = buildCodexArgs({ ...base, sandbox: "workspace-write" });
  assert.ok(writable.includes("--sandbox") && writable.includes("workspace-write"));
  assert.ok(!writable.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(writable[0], "exec");
  assert.ok(writable.includes("--output-schema") && writable.includes("--json") && writable.includes("--ephemeral"));

  const bypass = buildCodexArgs({ ...base, sandbox: "bypass" });
  assert.ok(bypass.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!bypass.includes("--sandbox"));

  const withModel = buildCodexArgs({ ...base, sandbox: "workspace-write", model: "gpt-x" });
  assert.ok(withModel.includes("--model") && withModel.includes("gpt-x"));
});

test("parseCodexLastMessage accepts the schema shape and normalizes findingResponses", () => {
  const result = parseCodexLastMessage(
    JSON.stringify({
      summary: "did work",
      files: ["index.html"],
      notes: [],
      findingResponses: [
        { findingId: "f1-1", status: "fixed" },
        { findingId: "f1-2", status: "bogus-status" },
        { bad: "shape" }
      ]
    })
  );

  assert.equal(result.summary, "did work");
  assert.deepEqual(result.reportedFiles, ["index.html"]);
  assert.deepEqual(result.findingResponses, [{ findingId: "f1-1", status: "fixed", note: undefined }]);
});

test("parseCodexLastMessage rejects malformed payloads", () => {
  assert.throws(() => parseCodexLastMessage("not json"), /not valid JSON/);
  assert.throws(() => parseCodexLastMessage('{"summary": 1, "files": [], "notes": []}'), /summary/);
  assert.throws(() => parseCodexLastMessage('{"summary": "s", "files": "nope", "notes": []}'), /files/);
});

test("renderBuildPrompt includes repair context on later iterations", () => {
  const goal = {
    objective: "Build a page",
    deliverableType: "web-app",
    acceptanceCriteria: ["It renders."],
    constraints: [],
    verificationCommands: [],
    stopConditions: [],
    manualApprovalCategories: [],
    rawSections: {}
  };
  const plan = { summary: "plan", steps: ["step"], risks: [] };

  const firstPrompt = renderBuildPrompt(goal, plan, {
    runDir: "C:/runs/x",
    workspaceRoot: "C:/ws",
    iteration: 1,
    codexSandbox: "workspace-write",
    previousEvaluations: []
  });
  assert.ok(firstPrompt.includes("first build pass"));
  assert.ok(firstPrompt.includes("C:/ws"));

  const repairPrompt = renderBuildPrompt(goal, plan, {
    runDir: "C:/runs/x",
    workspaceRoot: "C:/ws",
    iteration: 2,
    codexSandbox: "workspace-write",
    previousEvaluations: [
      { name: "command:npm test", status: "fail", summary: "failed", details: "boom" }
    ],
    previousReview: {
      summary: "issues",
      findings: [
        {
          id: "f1-1",
          severity: "blocking",
          title: "Broken layout",
          detail: "The page collapses on mobile.",
          suggestedAction: "Fix the flex container."
        }
      ]
    },
    previousBuilder: {
      summary: "built",
      files: [],
      notes: [],
      observedChanges: [{ path: "index.html", kind: "added" }]
    }
  });

  assert.ok(repairPrompt.includes("PREVIOUS REVIEW FINDINGS"));
  assert.ok(repairPrompt.includes("f1-1"));
  assert.ok(repairPrompt.includes("PREVIOUS FAILED EVALUATIONS"));
  assert.ok(repairPrompt.includes("PREVIOUS OBSERVED CHANGES"));
});
