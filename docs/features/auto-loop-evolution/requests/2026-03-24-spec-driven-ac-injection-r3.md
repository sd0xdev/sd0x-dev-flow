# Spec-Driven AC Injection into Code Review

> **Created**: 2026-03-24
> **Status**: Completed
> **Priority**: P2
> **Tech Spec**: [Auto-Loop Evolution](../2-tech-spec/2-tech-spec.md) Section 3.3 T3

## Background

Code review currently operates in "archaeological" mode — inferring intent from diffs alone. When a request doc with Acceptance Criteria exists, the reviewer should use it as a verification checklist. Infrastructure already exists: `resolve-feature.sh` (5-level feature detection) and `test-review` (AC parsing). Only the "inject AC into code review prompt" pipeline is missing.

## Requirements

- Detect request doc via `resolve-feature.sh` 5-level resolution
- Parse `## Acceptance Criteria` section (reuse test-review pattern)
- Filter quality-gate ACs
- Inject `## Specification Checklist` section into code review prompt
- Add `## AC Coverage` table to review output format
- Graceful degradation when no request doc or no AC section

## Scope

| Scope | Description |
|-------|-------------|
| In | AC detection, parsing, prompt injection, output format extension |
| Out | AC auto-generation from code; spec compliance scoring |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/codex-code-review/SKILL.md` | Modify | Add AC detection + injection flow |
| `skills/codex-code-review/references/codex-prompt-fast.md` | Modify | Add Specification Checklist template |
| `skills/codex-code-review/references/codex-prompt-full.md` | Modify | Add Specification Checklist template |
| `skills/codex-code-review/references/codex-prompt-branch.md` | Modify | Add Specification Checklist template |
| `skills/codex-code-review/references/review-common.md` | Modify | Add AC Coverage output format |
| `scripts/resolve-feature.sh` | Reuse | No change needed |
| `scripts/lib/feature-resolver.js` | Reuse | No change needed |

## Acceptance Criteria

- [x] Feature context resolved via `resolve-feature.sh` during code review
- [x] AC parsed from `## Acceptance Criteria` with quality-gate filter
- [x] `## Specification Checklist` injected into review prompt (when AC available)
- [x] Review output includes `## AC Coverage` table mapping AC to implementation status
- [x] Graceful degradation: no request doc / no AC section = skip silently
- [x] Token budget: AC injection bounded by tech-spec-defined cap (max 20 ACs)
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Deep Research + Tech Spec completed |
| Development | Done | Commit `bbf138c` |
| Testing | Done | 36 contract tests + Codex ✅ + precommit ✅ + CI ✅ |
| Acceptance | Done | All 8/8 AC checked |
