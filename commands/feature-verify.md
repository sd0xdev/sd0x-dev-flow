---
description: "Feature verification (READ-ONLY, P0-P5). Verifies deployed feature behavior through black-box API testing, log observation, and Codex confirmation."
argument-hint: "<feature to verify>" [--env <test|staging|prod>] [--level <L1-L4>]
allowed-tools: Read, Grep, Glob, Bash, WebFetch, Task, Skill, mcp__codex__codex, mcp__codex__codex-reply
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/feature-verify/SKILL.md

## Context

- Git diff: !`git diff --name-only HEAD~5..HEAD 2>/dev/null | head -20`
- Git status: !`git status -sb`
- Project root: !`git rev-parse --show-toplevel`
- Current branch: !`git rev-parse --abbrev-ref HEAD`

## Arguments

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `<feature>` | Feature, branch, or system to verify | Required |
| `--env <env>` | Target environment: `test`, `staging`, `prod` | `test` |
| `--level <L1-L4>` | Force degradation level (override auto-detect) | Auto |

## Workflow (P0-P5)

1. **P0: Scope & Safety** — Select environment, check reachability, confirm read-only, determine degradation level
2. **P1: Diff-Lite** — Map git diff to affected endpoints and dependency chains
3. **P2: Test Charter** — Design L1/L2/L3/M1 test cases, present to user for approval
4. **P3: API Execute** — Send read-only requests, record HTTP status / request ID / latency
5. **P4: Observation** — Correlate logs by request ID (L3+), time-window scan, blind spot analysis
6. **P5: Verdict** — Per-endpoint verdict + Claude analysis + Codex review + integrated report

## Key Rules

- **ALL operations must be READ-ONLY** — no write/update/delete
- **Endpoint allowlist** — only call endpoints listed in safety-rules.md
- **Single request** — one at a time, no load testing
- **Fixed test parameters** — no real user data or PII
- **User approval gate** — present test charter (P2) before executing (P3)
- **Dual verification** — Claude forms conclusion first, then Codex reviews independently

## Examples

```bash
/feature-verify "User Authentication" --env test
/feature-verify "Payment query" --env prod --level L2
/feature-verify "Cache optimization"
```
