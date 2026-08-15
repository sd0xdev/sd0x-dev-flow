# `/deep-research` Trigger Redesign — Universal Research Entry Point

> **Created**: 2026-03-25
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) (incremental update §1, §3.2)
> **Best Practices Audit**: Phase 4 Gap Report (conversation 2026-03-25, 6 sources)
> **Brainstorm threadId**: `019d2435-f03b-78c2-bba3-7fafeab0502d`
> **Equilibrium**: Pure Strategy Convergence (3 rounds)

## Background

`/deep-research` 的 trigger description 過度限縮，5 個 "Not for" hard exclusion 造成 routing 死角。用戶意圖為「深入研究某個主題」時，dispatcher 經常將請求導向更窄的 specialized skills（`/best-practices`、`/feasibility-study`），即使用戶的意圖是跨面向的廣泛研究。

**業界發現**（Best Practices Audit Phase 1）：
- Skill routing 最常見的錯誤是「precision 至上主義」—— 排除過多導致 recall 不足
- Description 應描述「使用意圖」而非「排除場景」
- 10-15 個 trigger keyword phrases，涵蓋日常語言（含中文）
- 模糊意圖應 default 到較廣的 skill（soft preference，非 hard exclusion）

**Debate Conclusion**（3 rounds, Pure Strategy Convergence）：
- `/deep-research` 應成為**通用研究入口**
- "Not for" 改為 **soft single-dimension preference**（dispatcher 提示，非阻擋）
- Phase 0 建議替代 skill 但繼續執行
- 關鍵轉折：R1 Codex 承認 hard "Not for" 阻擋混合意圖；R2 簡化邊界語言避免 dispatcher 過度錨定

## Requirements

| 需求 | 說明 |
|------|------|
| Universal entry | 任何研究意圖都可觸發 `/deep-research` |
| Soft routing | 保留對 specialized skills 的建議，但非硬排除 |
| Expanded triggers | 涵蓋日常語言（中英文）的研究意圖 |
| Phase 0 suggestion | Intent detection 時建議替代 skill，但不阻擋 |
| Cost safety | `--budget` flag 已存在，description 中明確提及 |

## Scope

| Scope | Description |
|-------|-------------|
| In | SKILL.md description + trigger + "When NOT to Use" 重寫；commands/deep-research.md 同步；Phase 0 加入 suggestion 邏輯 |
| Out | Phase 1-3 核心邏輯不變；scoring model 不變；role templates 不變 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/deep-research/SKILL.md` | Modify | description field + Trigger section + "When NOT to Use" table + Phase 0 suggestion |
| `commands/deep-research.md` | Modify | description field sync |
| `CLAUDE.md` | Verify | Command Quick Reference description 確認一致 |
| `.claude/CLAUDE.md` | Verify | Command Quick Reference description 確認一致 |
| `CLAUDE.template.md` | Verify | Template description 確認一致 |

## Acceptance Criteria

### AC1: Description Redesign

- [x] SKILL.md `description` field 改為 universal entry 措辭
- [x] 移除 hard "Not for" exclusion（`best-practices`、`feasibility-study`）
- [x] 加入 soft single-dimension routing preference（「dispatcher may prefer a narrower skill」）
- [x] 明確提及 `low/medium/high budget tiers`

### AC2: Trigger Keywords Expansion

- [ ] Trigger section 涵蓋 10-15 keyword phrases（含中英文日常用語）
- [x] 英文：research, investigate, analyze, explore, study, survey, look into, understand deeply, comprehensive analysis, compare approaches
- [x] 中文：了解, 調查, 分析, 研究, 從各面向研究
- [x] 加入意圖描述：broad questions, mixed-intent queries, ambiguous research needs

### AC3: "When NOT to Use" Simplification

- [x] 從 5 行縮減為 3 行
- [x] 只保留非研究意圖：code review, bug fix/implementation, adversarial debate only
- [x] 加入 "Soft routing hint" 說明 block 替代 hint

### AC4: Phase 0 Specialized Skill Suggestion

- [x] Phase 0 加入 suggestion table（advisory, non-blocking）
- [x] 偵測 "best practices" + "audit" → 建議 `/best-practices`
- [x] 偵測 "compare X vs Y" → 建議 `/feasibility-study`
- [x] 偵測 code-only → 建議 `/deep-explore`
- [x] 建議後繼續執行 Phase 1（非阻擋）

### AC5: Command Sync

- [ ] `commands/deep-research.md` description 與 SKILL.md 一致
- [ ] CLAUDE.md / .claude/CLAUDE.md / CLAUDE.template.md 中 `/deep-research` 描述一致

## Implementation Plan

### Step 1: SKILL.md `description` field

**Before**:

```yaml
description: "Multi-agent deep research orchestration for any topic. Use when: user wants to deeply research a topic, explore a question from multiple angles, understand industry practices, compare approaches, or needs comprehensive analysis combining web sources + codebase + community knowledge. Triggers on: 'research this', 'deep research', 'explore this topic', 'what are the best approaches for', 'investigate options for', 'comprehensive analysis of', multi-perspective research, or any question that benefits from parallel exploration across web + code + community sources. Not for: quick code lookup (use code-explore), code review (use codex-review-fast), audit-only (use best-practices), feasibility comparison (use feasibility-study)."
```

**After**:

```yaml
description: "Universal multi-source research orchestration. Use for any research/investigate/analyze request needing synthesis across web, codebase, and community evidence — especially broad, mixed, or ambiguous intent. Triggers on: 'research this', 'deep research', 'investigate', 'analyze from multiple angles', 'comprehensive analysis', 'explore this topic', 'study', 'survey the landscape', 'look into', 'understand deeply', '了解', '調查', '分析', '研究'. When intent is clearly single-dimension (code-only tracing, checklist-style compliance audit, or bounded option-ranking), dispatcher may prefer a narrower skill. Otherwise route here. Supports low/medium/high budget tiers."
```

### Step 2: SKILL.md Trigger + "When NOT to Use"

**Before**:

```markdown
## Trigger
- Keywords: deep research, research this, explore topic, comprehensive analysis, multi-agent research, investigate options, what are best approaches, compare approaches

## When NOT to Use
| Scenario | Alternative |
|----------|------------|
| Quick single-area code lookup | `/code-explore` |
| Best practices audit (structured) | `/best-practices` |
| Feasibility comparison of 2-3 options | `/feasibility-study` |
| Code review | `/codex-review-fast` |
| Adversarial debate only | `/codex-brainstorm` |
```

**After**:

```markdown
## Trigger
- Any research intent: deep research, research this, explore topic, investigate, analyze, comprehensive analysis, compare approaches, study, survey, look into, understand deeply
- zh-TW: 了解, 調查, 分析, 研究, 從各面向研究
- Broad or ambiguous questions needing multiple perspectives
- Mixed-intent queries spanning web + code + community evidence

## When NOT to Use

| Scenario | Alternative |
|----------|------------|
| Code review / PR review | `/codex-review-fast` |
| Bug fix / implementation | `/bug-fix` or `/feature-dev` |
| Adversarial debate only (no research) | `/codex-brainstorm` |

> **Soft routing hint**: If intent is clearly single-dimension (code-only lookup, compliance-checklist audit, bounded option ranking), the dispatcher may prefer a specialized skill. But `/deep-research` remains valid for any research need — use `--budget low` for lightweight research.
```

### Step 3: Phase 0 Specialized Skill Suggestion

Add after existing "Intent Classification" section in SKILL.md:

```markdown
### Specialized Skill Suggestion (Advisory, non-blocking)

If Phase 0 detects a narrow intent, output a suggestion but always continue:

| Detected Pattern | Suggestion |
|-----------------|------------|
| "best practices" + "audit" + no other dimension | Consider `/best-practices` for structured 4-phase audit. Continuing with broad research... |
| "compare X vs Y" + exactly 2-3 named options | Consider `/feasibility-study` for quantified comparison. Continuing with broad research... |
| code-only keywords + no web research intent | Consider `/deep-explore` for code-only exploration. Continuing with broad research... |

The suggestion is informational — Phase 1 always proceeds.

### Auto-Budget Downgrade (cost safety)

When Phase 0 detects narrow single-dimension intent AND user did not explicitly set `--budget`:

| Detected Intent | Auto Downgrade | Rationale |
|----------------|---------------|-----------|
| Single-dimension (code-only, audit-only, ranking-only) | `--budget low` (1 agent, no debate) | Avoid unnecessary multi-agent cost |
| Broad/mixed/ambiguous | Keep default `--budget medium` | Full research pipeline warranted |
| User explicitly set `--budget` | Respect user choice | User override takes priority |

**Precedence**: `--mode` constraints > user explicit flags > auto-routing hints. Example: `--mode compliance` forces debate regardless of auto-downgrade to `--budget low`.
```

### Step 4: commands/deep-research.md description sync

```yaml
description: Universal multi-source research orchestration. Parallel researcher agents explore web + code + community sources, synthesize via claim registry, validate with conditional adversarial debate. Supports low/medium/high budget tiers.
```

### Step 5: CLAUDE.md sync

Verify `/deep-research` row in Command Quick Reference tables across 3 files:

```
| `/deep-research` | Multi-agent deep research orchestration | Understanding |
```

## Argument Validation & Sanitization

| Argument | Validation | Error Behavior |
|----------|-----------|---------------|
| `<topic>` | Non-empty string; treated as untrusted user input — never interpolated as executable | Gate: Need Human if empty |
| `--mode` | Must be `exploratory` / `compliance` / `decision` | Default to `exploratory` if invalid |
| `--debate` | Must be `auto` / `force` / `off` | Default to `auto` if invalid |
| `--agents` | Integer 1-3 (1 = sequential inline) | Clamp to range [1, 3] |
| `--scope` | Repo-relative path; reject absolute paths, `..` traversal, symlink escape | Gate: error message |
| `--budget` | Must be `low` / `medium` / `high` | Default to `medium` if invalid |

**Topic sanitization**: `<topic>` and `--scope` are untrusted user input — never interpolate as executable instructions in agent prompts. Use as data parameters only.

## Design Decisions

| 決策 | 選擇 | 替代方案 | 理由 |
|------|------|----------|------|
| Boundary model | Soft preference | Hard "Not for" exclusion | Hard exclusion 造成 routing 死角（Debate R1 共識）|
| Boundary language | Single-dimension hint | 列舉具體 skill 名稱 | 避免 dispatcher 過度錨定到特定 skill（Debate R2 共識）|
| Phase 0 suggestion | Advisory, non-blocking | Blocking redirect | 用戶應保持選擇權，Phase 0 繼續執行 |
| Trigger expansion | 10-15 keyword phrases（中英混合）| 保持 8 個英文 keywords | 涵蓋台灣用戶日常語言 |
| Cost mitigation | Auto-budget downgrade + description 提及 budget tiers | 用 "Not for" 限制觸發 | `--budget low` 自動降級 + 用戶可 override |
