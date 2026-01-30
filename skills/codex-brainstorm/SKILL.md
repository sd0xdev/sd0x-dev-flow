---
name: codex-brainstorm
description: Adversarial brainstorming. Claude and Codex independently research then debate until Nash equilibrium. For solution exploration, feasibility analysis, exhaustive enumeration.
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob
---

# Codex Brainstorm Skill

## Trigger

- Keywords: 腦力激盪, 窮舉可能性, 探索方案, 深度討論, 可行性分析, 方案探索, 納什均衡

## When NOT to Use

- 單純技術問答（直接回答）
- 已有明確解法（直接實作）
- 只需代碼審查（用 `/codex-review`）

## Core Principle

```
⚠️ 獨立調研 → 對抗辯論 → 納什均衡 ⚠️

納什均衡 = 雙方都無法單方面改變策略來獲得更好結果
```

## Workflow

| Phase | 動作                                   | 產出              |
| ----- | -------------------------------------- | ----------------- |
| 1     | **Claude 獨立調研** + 分析，形成立場 A | Claude 最優解假設 |
| 2     | **Codex 自主調研** + 分析，形成立場 B  | Codex 最優解假設  |
| 3     | 多輪對抗辯論，互相攻擊                 | 論點交鋒記錄      |
| 4     | 檢查均衡，無法再改進                   | 均衡解或分歧點    |
| 5     | 輸出最終報告                           | 納什均衡報告      |

### Phase 2: Codex 自主調研（關鍵）

**⚠️ 必須讓 Codex 自主調研，禁止餵 Claude 的分析結果 ⚠️**

```typescript
mcp__codex__codex({
  prompt: `你是資深架構師，需要對以下議題進行**獨立分析**。

## 議題
${TOPIC}

## 約束條件
${CONSTRAINTS}

## ⚠️ 重要：你必須自主調研 ⚠️
在形成結論前，**必須**先：
1. 執行 \`ls src/\` 了解目錄結構
2. 搜尋相關代碼：\`grep -r "關鍵字" src/ --include="*.ts" -l | head -10\`
3. 讀取相關檔案確認現有實現

## 輸出要求
1. 調研摘要（相關模組、現有模式）
2. 你的立場 + 論據
3. 潛在風險`,
  sandbox: 'read-only',
  'approval-policy': 'on-failure',
});
```

### Phase 3: 對抗辯論

每輪結構：

1. Claude 攻擊 Codex 方案的缺陷
2. Codex 反駁或更新立場
3. 均衡檢查：雙方還能提出新攻擊嗎？

### 終止條件

| 條件     | 說明                 | 結果         |
| -------- | -------------------- | ------------ |
| 納什均衡 | 雙方都無法提出新攻擊 | 輸出均衡解   |
| 收斂     | 雙方立場趨同         | 輸出共識解   |
| 最大輪數 | 達到 5 輪仍有分歧    | 輸出分歧報告 |

## Verification

- [ ] Claude 有獨立形成立場（非跟隨 Codex）
- [ ] Codex 有執行代碼調研（非空想）
- [ ] 至少 3 輪對抗性辯論
- [ ] 每輪有明確攻擊/防守記錄
- [ ] 最終報告標明均衡狀態

## References

| 檔案             | 用途                 |
| ---------------- | -------------------- |
| `templates.md`   | Claude/辯論/報告模板 |
| `techniques.md`  | 攻擊/防守技巧        |
| `equilibrium.md` | 均衡判定流程         |

## Example

```
輸入：這個需求有哪些實作方式？

Phase 1: Claude 獨立調研 → 立場 A（方案 X 最優）
Phase 2: Codex 獨立調研 → 立場 B（方案 Y 最優）
Phase 3: 對抗辯論
  - R1: Claude 攻擊 Y 的擴展性 / Codex 攻擊 X 的複雜度
  - R2: Claude 反駁 / Codex 承認並更新立場
  - R3: 雙方趨同到方案 Z，無法再攻擊 → 均衡
Phase 4: 輸出納什均衡解 = 方案 Z
```
