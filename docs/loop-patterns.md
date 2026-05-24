# Codex and Claude Loop Patterns

This document compares orchestration patterns for a goal-driven `Codex <-> Claude` self-improvement loop.

## 1. Builder Reviewer Repair

```text
Codex builds -> tests run -> Claude reviews -> Codex repairs
```

Best for: web apps, games, small systems, bug fixes.

Pros:
- Simple and robust.
- Clear responsibility split.
- Easy to stop after each iteration.

Cons:
- Claude may find issues that are hard to turn into concrete patches.
- Codex may overfit to review comments if acceptance criteria are vague.

## 2. Claude Spec First, Codex Implements

```text
Claude normalizes GOAL.md -> Codex implements -> evaluators verify
```

Best for: ambiguous ideas, product specs, UX-heavy work.

Pros:
- Reduces unclear requirements before code starts.
- Produces better acceptance criteria.

Cons:
- Extra planning step costs time.
- Bad normalized specs can steer the whole run incorrectly.

## 3. Test First

```text
Claude writes tests/spec -> Codex implements until tests pass
```

Best for: libraries, APIs, deterministic behavior.

Pros:
- Strong stop condition.
- Low subjective judgment.

Cons:
- Weak for visual design, games, and creative media.
- Tests can encode the wrong behavior.

## 4. Parallel Alternatives Tournament

```text
Codex branch A
Codex branch B
Claude branch C
evaluators + reviewer choose winner
```

Best for: UI concepts, game prototypes, architectural spikes.

Pros:
- Finds better solutions than a single path.
- Useful when requirements are broad.

Cons:
- Expensive.
- Needs worktree isolation and a good scoring rubric.

## 5. Specialist Pipeline

```text
Planner -> Designer -> Builder -> Tester -> Reviewer -> Release Auditor
```

Best for: larger products.

Pros:
- Each role can have specific prompts and tools.
- Good for scaling to complex deliverables.

Cons:
- More orchestration code.
- Slow if every task goes through every role.

## 6. Red Team Hardening

```text
Codex implements -> Claude attacks/security-reviews -> Codex hardens
```

Best for: auth, data handling, admin tools, public apps.

Pros:
- Surfaces risks normal build loops miss.
- Good before publishing.

Cons:
- Can become conservative and slow.
- Needs strict scope to avoid speculative findings.

## 7. Visual QA Loop

```text
Codex builds UI -> Playwright captures screenshots -> Claude reviews UX -> Codex fixes
```

Best for: websites, dashboards, games.

Pros:
- Catches real rendering issues.
- Produces strong evidence with screenshots.

Cons:
- Requires stable browser automation.
- Visual review can be subjective without a rubric.

## 8. Migration Loop

```text
Claude plans migration -> Codex performs mechanical edits -> tests verify -> Claude audits
```

Best for: dependency upgrades, framework migrations, large refactors.

Pros:
- Good separation between strategy and mechanics.
- Checkpoint-friendly.

Cons:
- Needs strong rollback and diff review.
- Can fail on hidden runtime behavior.

## 9. Media Generation Loop

```text
Claude writes script/storyboard -> tools render -> Claude reviews -> Codex adjusts pipeline
```

Best for: slides, documents, videos, image-heavy artifacts.

Pros:
- Extends beyond code.
- Works well with render-and-verify flows.

Cons:
- Evaluators are harder to make deterministic.
- Large binary artifacts need storage rules.

## 10. Self-Improving Runner Loop

```text
failed run -> Claude diagnoses orchestration weakness -> Codex updates prompts/templates/evals
```

Best for: improving this repository itself.

Pros:
- The runner gets better from evidence.
- Converts failures into reusable templates.

Cons:
- High risk of prompt drift.
- Must require tests and human review before changing policy.

## Recommended Default

Start with Pattern 1 plus Pattern 2:

```text
Claude spec normalization -> Codex build -> evaluators -> Claude review -> Codex repair
```

Add Pattern 7 for web/game work and Pattern 10 only after the runner has good tests.

