# Codex Instructions

## Documentation-Driven Development

This repository follows documentation-driven development. When design changes are needed, update the relevant documentation first, then update code to match it.

## Verify Before Assuming

Do not rely on guesses for APIs, files, flags, or prior decisions. Check source files, official documentation, or project documentation before referencing them. If the answer cannot be verified, ask the user instead of inventing details.

## Safety

The runner is allowed to automate local development tasks, but destructive actions, credential handling, publishing, payments, account changes, and third-party communications must be gated by an explicit policy check and user approval.

