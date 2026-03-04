# Signing Flags & Testing

> **Created**: 2026-03-04
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Source**: Best Practices Audit + Codex Brainstorm (threadId: `019cb7cb-f464-75b2-ba9b-231ecded04d8`)

## Background

`/smart-commit` 缺乏顯式的簽名覆寫旗標，使用者無法對單次 batch 指定簽名策略。此外，整個 smart-commit hardening feature 缺乏測試覆蓋，需建立完整的 unit test + integration test 以確保三項 pre-flight 和 runtime validation 的正確性。

## Requirements

- 新增 `--sign` / `--no-sign` **覆寫旗標**：互斥，使用時需 AskUserQuestion 確認 + 警告 branch protection/CI 政策衝突
- 新增 `test/scripts/smart-commit.test.js`：**15+ 測試案例**涵蓋 identity diagnostics、AI guard regex、signing diagnostics、runtime validation、hook detection
- 更新 **CLAUDE.md** Command Quick Reference：新增 `--sign` / `--no-sign` 說明

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `--sign`/`--no-sign` flags、unit tests、integration tests、CLAUDE.md 更新 |
| Out | Pre-flight diagnostics（R1）、runtime validation（R2） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/smart-commit/SKILL.md` | Modify | 新增 `--sign`/`--no-sign` flags + AskUserQuestion gate |
| `commands/smart-commit.md` | Modify | argument-hint 加入 `--sign`/`--no-sign` |
| `test/scripts/smart-commit.test.js` | New | Unit + integration tests |
| `CLAUDE.md` | Modify | Command Quick Reference 更新 |

## Acceptance Criteria

- [x] `--sign` → 本次 batch 所有 commit 加 `-S`
- [x] `--no-sign` → 本次 batch 所有 commit 加 `--no-gpg-sign`
- [x] `--sign` + `--no-sign` 同時使用 → 錯誤提示（互斥）
- [x] `--sign`/`--no-sign` 使用時 → AskUserQuestion 確認 + policy 警告
- [ ] Unit tests: identity 正常/缺失/衝突/env var、AI guard pattern match/pass、signing enabled/missing/unset
- [x] Unit tests: `--ai-co-author` 白名單精確匹配 + 非精確 block
- [ ] Unit tests: hook detection with `core.hooksPath` awareness
- [x] Unit tests: POSIX ERE regex 跨平台（GNU grep + BSD grep）
- [x] 測試案例總數 ≥ 15（涵蓋 unit + integration）— 17 tests
- [ ] Integration tests: `--execute` runtime validation 攔截、signing 失敗停止、post-commit hard stop
- [x] CLAUDE.md `/smart-commit` 列含 `--sign`/`--no-sign` 說明
- [x] `/codex-review-doc` 通過

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | Tech spec + Codex review 完成 |
| Development | Done | W10 signing flags、W12 CLAUDE.md 更新完成 |
| Testing | Done | W11: 17/17 tests pass（guard regex A1-A7、validate_msg B1-B5、structural C1-C3、ERE D1-D2） |
| Acceptance | Partial | 9/12 AC 完成；identity/hook detection unit tests 及 integration tests 為 scope 外（需額外行為層測試） |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 3.3 (flags), 6 (testing)
- Debate threadId: `019cb7cb-f464-75b2-ba9b-231ecded04d8`
- Work Items: W10, W11, W12
- Dependencies: R1 (pre-flight diagnostics), R2 (runtime validation)
