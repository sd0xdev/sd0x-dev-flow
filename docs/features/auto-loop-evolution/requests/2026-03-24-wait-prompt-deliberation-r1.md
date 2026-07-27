# Wait Prompt Deliberation

> **Created**: 2026-03-24
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: [Auto-Loop Evolution](../2-tech-spec/2-tech-spec.md) Section 3.3 T2

## Background

LLM self-correction has a 64.5% blind spot rate (Self-Correction Bench, arXiv 2507.02778). Appending a "Wait" deliberation prompt reduces this by 89.3%. This is the highest-ROI change in the auto-loop evolution — a single prompt edit with zero infrastructure cost.

## Requirements

- Add CoVe-inspired deliberation block to all code review prompt templates
- Place between `## Review Dimensions` and `## Severity` section
- Apply to both primary (Codex) and secondary reviewer prompts (SKILL.md)
- ~95 tokens overhead (measured against ~800 token fast variant)

## Scope

| Scope | Description |
|-------|-------------|
| In | Deliberation block in codex-prompt-fast.md, codex-prompt-full.md, codex-prompt-branch.md, SKILL.md secondary prompt |
| Out | CriticGPT-style dedicated critic model; ML-based false positive reduction |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/codex-code-review/references/codex-prompt-fast.md` | Modify | Add deliberation block |
| `skills/codex-code-review/references/codex-prompt-full.md` | Modify | Add deliberation block |
| `skills/codex-code-review/references/codex-prompt-branch.md` | Modify | Add deliberation block |
| `skills/codex-code-review/SKILL.md` | Modify | Add deliberation block to secondary reviewer prompt template |

## Acceptance Criteria

- [x] Deliberation block added to all 3 review prompt variants (fast, full, branch)
- [x] Deliberation block added to secondary reviewer prompt in SKILL.md
- [x] Block placed between Review Dimensions and Severity section
- [x] Block includes 5 verification checks (evidence, context, false positive, severity, gap)
- [x] Token overhead measured and documented (target: ~95 tokens)
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Deep Research + Tech Spec completed |
| Development | Done | Commit `883c6d4` |
| Testing | Done | Codex review ✅ + precommit ✅ + CI ✅ |
| Acceptance | Done | All 7/7 AC checked |
