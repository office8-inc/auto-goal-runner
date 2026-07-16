import type { Goal, PolicyCheck } from "./types.js";

/**
 * Default-deny command policy for verification commands. See docs/architecture.md,
 * Policy Engine: this gates what the runner executes, not what the builder agent
 * runs inside its own sandboxed session.
 */

type PatternRule = { pattern: RegExp; rule: string };

const DENY_RULES: PatternRule[] = [
  { pattern: /\bnpm\s+publish\b/i, rule: "deny:publish" },
  { pattern: /\byarn\s+publish\b/i, rule: "deny:publish" },
  { pattern: /\bpnpm\s+publish\b/i, rule: "deny:publish" },
  { pattern: /\bgit\s+push\b/i, rule: "deny:push" },
  { pattern: /\bgh\s+(pr|release|repo)\b/i, rule: "deny:github-write" },
  { pattern: /\b(vercel|netlify|wrangler|firebase)\s+(deploy|publish)\b/i, rule: "deny:deploy" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, rule: "deny:destructive-git" },
  { pattern: /\bgit\s+clean\b/i, rule: "deny:destructive-git" },
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\b/i, rule: "deny:destructive-filesystem" },
  { pattern: /\brmdir\s+\/s\b/i, rule: "deny:destructive-filesystem" },
  { pattern: /\bdel\s+\/[sq]\b/i, rule: "deny:destructive-filesystem" },
  { pattern: /remove-item\b.*-recurse/i, rule: "deny:destructive-filesystem" },
  { pattern: /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|zsh|node|python|pwsh|powershell)\b/i, rule: "deny:remote-script" },
  { pattern: /\b(ssh|scp|sftp|rsync)\b/i, rule: "deny:remote-shell" },
  { pattern: /\bstripe\b|\bpayment\b/i, rule: "deny:payment" },
  { pattern: /\.env\b|\bsecrets?\b|\bcredentials?\b|\bauth\.json\b/i, rule: "deny:credential-access" },
  { pattern: /\bsudo\b/i, rule: "deny:privilege-escalation" }
];

const MANUAL_APPROVAL_CATEGORY_RULES: Record<string, RegExp> = {
  publish: /\b(publish|release)\b/i,
  deploy: /\b(deploy|pages|ship)\b/i,
  "network-write": /\b(curl|wget|iwr|invoke-webrequest|fetch|post)\b/i,
  "destructive-filesystem": /\b(rm|del|rmdir|remove-item|format)\b/i
};

const ALLOW_RULES: PatternRule[] = [
  { pattern: /^npm\s+(test|ci|install)(\s|$)/, rule: "allow:npm" },
  { pattern: /^npm\s+run\s+[\w:.-]+(\s|$)/, rule: "allow:npm-script" },
  { pattern: /^npx\s+(tsc|vitest|jest|eslint|prettier|tsx)\b/, rule: "allow:npx-tool" },
  { pattern: /^npx\s+playwright\s+test\b/, rule: "allow:playwright" },
  { pattern: /^node\s+(--test\s+)?[\w./\\:-]+(\s|$)?/, rule: "allow:node-script" },
  { pattern: /^(tsc|vitest|jest)(\s|$)/, rule: "allow:test-tool" },
  { pattern: /^cargo\s+(build|test|check|clippy)(\s|$)/, rule: "allow:cargo" },
  { pattern: /^(python|python3)\s+-m\s+(pytest|unittest)\b/, rule: "allow:pytest" },
  { pattern: /^(pytest|go\s+(build|test|vet))(\s|$)/, rule: "allow:test-tool" }
];

/**
 * Commands are executed with shell:true, so an allowed-looking prefix followed
 * by an operator would run the whole chain. Any shell metacharacter therefore
 * disqualifies a command from the allow list (quoting is deliberately not parsed).
 */
const SHELL_METACHARACTERS = /[;&|`$<>\n\r]/;

const OUTWARD_ACTION_NAMES = /\b(deploy|publish|release|upload|ship)\b/i;

export function checkCommandPolicy(command: string, goal: Goal): PolicyCheck {
  assertKnownCategories(goal.manualApprovalCategories);
  const trimmed = command.trim();

  for (const { pattern, rule } of DENY_RULES) {
    if (pattern.test(trimmed)) {
      return { command, decision: "deny", rule };
    }
  }

  for (const category of goal.manualApprovalCategories) {
    const pattern = MANUAL_APPROVAL_CATEGORY_RULES[category];
    if (pattern.test(trimmed)) {
      return { command, decision: "requiresApproval", rule: `goal-gate:${category}` };
    }
  }

  if (SHELL_METACHARACTERS.test(trimmed)) {
    return { command, decision: "requiresApproval", rule: "default-deny:shell-metacharacters" };
  }

  // "npm run deploy" や "node publish.js" のような外向きアクション名のスクリプトが
  // 汎用 allow ルールを通過しないよう、名前ベースで承認を要求する。
  if (OUTWARD_ACTION_NAMES.test(trimmed)) {
    return { command, decision: "requiresApproval", rule: "default-deny:outward-action-name" };
  }

  for (const { pattern, rule } of ALLOW_RULES) {
    if (pattern.test(trimmed)) {
      return { command, decision: "allow", rule };
    }
  }

  return { command, decision: "requiresApproval", rule: "default-deny:unknown-command" };
}

export function checkCommandPolicies(commands: string[], goal: Goal): PolicyCheck[] {
  assertKnownCategories(goal.manualApprovalCategories);
  return commands.map((command) => checkCommandPolicy(command, goal));
}

/** A misspelled category would silently disable its gate, so fail loudly instead. */
function assertKnownCategories(categories: string[]): void {
  for (const category of categories) {
    if (!(category in MANUAL_APPROVAL_CATEGORY_RULES)) {
      throw new Error(
        `Unknown manual-approval category in GOAL.md: "${category}". ` +
          `Known categories: ${Object.keys(MANUAL_APPROVAL_CATEGORY_RULES).join(", ")}.`
      );
    }
  }
}
