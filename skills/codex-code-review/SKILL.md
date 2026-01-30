---
name: codex-code-review
description: Code review skill with rubric and templates
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Codex Code Review

## Trigger

- Keywords: review, PR, bug, security, performance, 測試覆蓋, 審查, 檢查

## When NOT to Use

- 只是想了解代碼功能（用 Explore）
- 需要實作修復（用 feature-dev）
- 文檔審查（用 doc-review）

## Workflow

```mermaid
sequenceDiagram
    participant U as User
    participant S as Skill
    participant C as Codex

    U->>S: review request
    S->>C: /codex-review-fast 或 /codex-review
    C-->>S: second opinion
    S->>S: apply rubric
    S-->>U: P0/P1/P2/Nit + Gate
```

## Verification

- 每個問題標記嚴重程度（P0/P1/P2/Nit）
- Gate 明確（✅ Pass / ⛔ Block）
- 問題包含：位置、描述、修復建議

## References

- Rubric: `review_rubric.md`
- Output: `templates/review_output.md`

## Examples

```
輸入：幫我 review 這個 PR
動作：/codex-review-fast → 套用 rubric → 輸出 P0/P1/P2/Nit + Gate
```

```
輸入：檢查這段代碼的安全性
動作：/codex-security → 套用 OWASP rubric → 輸出安全問題
```

```
輸入：這個函數有什麼問題嗎？
動作：Read 函數 → 套用 rubric → 輸出問題列表
```
