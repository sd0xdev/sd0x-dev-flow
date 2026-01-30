---
description: 對抗性腦力激盪。Claude 和 Codex 獨立調研專案後對抗辯論，直到納什均衡。
argument-hint: "<議題描述>" [--constraints <約束>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob, Bash(ls:*), Bash(find:*)
skills: codex-brainstorm
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- Project structure: !`ls -la src/ 2>/dev/null | head -15`
- Services: !`ls src/service/ 2>/dev/null | head -10`
- Providers: !`ls src/provider/ 2>/dev/null | head -10`

## Task

對議題進行對抗性腦力激盪，**雙方必須各自調研專案後**再辯論，直到達成納什均衡。

### 議題

```
$ARGUMENTS
```

### ⚠️ 關鍵：雙方獨立調研 ⚠️

| Phase | 執行者 | 調研要求                                   |
| ----- | ------ | ------------------------------------------ |
| 1     | Claude | 使用 Read/Grep/Glob 調研相關代碼，形成立場 |
| 2     | Codex  | **自主執行** ls/grep/cat 調研，形成立場    |

**禁止**：Claude 把自己的分析結果餵給 Codex。Codex 必須自己調研。

### Codex 自主調研設定

呼叫 Codex 時必須使用：

```typescript
mcp__codex__codex({
  prompt: '...',
  sandbox: 'read-only', // 允許讀取檔案
  'approval-policy': 'on-failure', // 命令失敗才需確認
});
```

### 執行指引

遵循 skill 中的流程和模板：

| 階段       | 參考文件                                                   |
| ---------- | ---------------------------------------------------------- |
| 流程       | @skills/codex-brainstorm/SKILL.md                  |
| Codex 調研 | @skills/codex-brainstorm/SKILL.md#phase-2          |
| 辯論技巧   | @skills/codex-brainstorm/references/techniques.md  |
| 均衡判定   | @skills/codex-brainstorm/references/equilibrium.md |
| 報告模板   | @skills/codex-brainstorm/references/templates.md   |

## Examples

```bash
/codex-brainstorm "如何設計一個高併發的快取系統？"
/codex-brainstorm "用戶配額管理功能" --constraints "不能改現有 API"
/codex-brainstorm "Redis vs MongoDB 作為快取層？"
```
