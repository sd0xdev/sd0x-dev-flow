# Structured Output Schema (D-5)

> **Created**: 2026-03-31
> **Status**: Candidate Complete
> **Priority**: P2
> **Tech Spec**: [Tech Spec](../2-tech-spec/1-phase-d-hook-hardening.md) <- Phase D, Section D-5

## Background

Sentinel parsing（`✅ Ready`、`## Gate: ✅`）用 regex 匹配 Codex 輸出。格式變化時靜默失敗。incremental 引入 JSON structured output 作為 secondary enrichment channel。

## Requirements

- Review prompt 末尾新增 optional JSON block 指示
- `post-tool-review-state.sh` 先嘗試 JSON parsing，fallback 到 text sentinel
- 定義衝突策略：JSON gate vs text sentinel mismatch → fail-closed BLOCKED
- 不改變 primary gate mechanism（text sentinel 維持為主）

## Scope

| Scope | Description |
|-------|-------------|
| In | Prompt 擴展、JSON parsing、衝突策略、unit tests |
| Out | 強制 JSON-only output、output schema validation、Codex CLI --output-schema |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/codex-code-review/references/codex-prompt-fast.md` | Modify | 新增 optional JSON block section |
| `skills/codex-code-review/references/codex-prompt-full.md` | Modify | 同上 |
| `hooks/post-tool-review-state.sh` | Modify | 新增 `_parse_review_gate()` JSON-first fallback |
| `test/hooks/structured-output-parse.test.js` | New | JSON parsing + fallback + conflict tests |

## Acceptance Criteria

- [x] Codex 輸出含 JSON block 時正確 parse gate 值
- [x] Codex 輸出無 JSON block 時 fallback 到 text sentinel（不 break）
- [x] JSON says READY but text says BLOCKED → result = BLOCKED（fail-closed）
- [x] Parse failure（invalid JSON）→ fallback 到 text sentinel
- [x] 不影響現有 review workflow（backward compatible）
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | |
| Development | Done | |
| Testing | Done | |
| Acceptance | Done | |

## References

- Tech Spec: [auto-loop-evolution](../2-tech-spec/1-phase-d-hook-hardening.md) Phase D, D-5
- Source: codex-plugin-cc review-output.schema.json
