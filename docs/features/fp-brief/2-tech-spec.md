# fp-brief: First-Principles Briefing Skill — Technical Spec

## 1. Requirement Summary

- **Problem**: 技術文件（tech spec、feasibility study、request doc）記錄了「決定了什麼」和「怎麼做」，但**從第一性原理推導的因果鏈**是隱含的。新成員、reviewer、或未來的自己無法快速理解「為什麼這是根本正確的做法」，導致知識斷層和次優決策。
- **Goals**:
  1. 從任何已完成的 markdown 技術文件中提取第一性原理推理鏈
  2. 產出結構化的 7-section briefing（不是摘要，是因果鏈重組）
  3. 保留技術深度，但重新組織為：假設 → 原理 → 推理 → 決策
  4. 三級深度控制（brief / normal / deep）
  5. 可選的 Codex 獨立驗證（default off）
- **Scope**:
  - 輸入：任何 `.md` 技術文件（混合式自動偵測格式）
  - 輸出：`*-fp-brief.md` 檔案（可選 stdout）
  - 執行模式：inline（v1，不使用 subagent）
- **Non-goals**:
  - 不取代 `/project-brief`（PM/CTO audience，會移除技術細節）
  - 不取代 `/feasibility-study`（pre-doc 分析，fp-brief 是 post-doc 提煉）
  - 不做文件生成或修改（純讀取 + 產出新檔案）
  - 不支援非 markdown 格式（v1）

## 2. Existing Code Analysis

### Related Modules

| File | Relevance |
|------|-----------|
| `commands/project-brief.md` | 最接近的現有 skill；但刻意移除技術細節（Key design decisions → Remove） |
| `skills/feasibility-study/SKILL.md` | 已有 5-Why 分解和第一性原理 DNA；但在文件之前執行，非之後 |
| `skills/feasibility-study/references/analysis-phases.md` | Phase 1 Requirement Decomposition 可複用 |
| `skills/codex-explain/SKILL.md` | `brief/normal/deep` 三級深度 UX 模式的規範來源 |
| `skills/create-request/references/feature-context-resolution.md` | 5-level feature context cascade；fp-brief 可複用路徑偵測 |
| `skills/deep-research/SKILL.md` | 多 phase 結構化 skill 的成熟範例 |

### Reusable Components

| Component | Reuse Point |
|-----------|-------------|
| `brief/normal/deep` depth 模式 | 直接複用 codex-explain 的 UX 慣例 |
| `*-brief.md` 輸出命名 | 延伸 project-brief 的 suffix 慣例 → `*-fp-brief.md` |
| Feature context resolution | 用於已知格式偵測（path pattern matching） |
| 5-Why 分解模板 | 從 feasibility-study 複用，作為 Root Problem extraction 的結構 |

### Design Constraints

| Constraint | Source | Implication |
|------------|--------|-------------|
| SKILL.md 標準格式 | Plugin architecture | frontmatter + sections 結構 |
| Auto-loop：`.md` 產出觸發 `/codex-review-doc` | `auto-loop.md` | 產出的 `-fp-brief.md` 是 doc change |
| Codex 獨立研究 | `codex-invocation.md` | `--verify codex` 模式必須遵守 |
| Git workflow | `git-workflow.md` | 不可 git add/commit/push |
| 輸出語言 | `docs-writing.md` locale rules | 由當前會話語言決定；非硬編碼預設 |
| 路徑安全 | `security.md` | 輸入路徑必須在 repo boundary 內；輸出不可包含 secrets/tokens |

## 3. Technical Solution

### 3.1 Architecture Design

```mermaid
sequenceDiagram
    participant U as User
    participant S as /fp-brief
    participant D as Source Doc
    participant O as Output File
    participant X as Codex (optional)

    U->>S: /fp-brief <doc-path> [--depth] [--verify]
    Note over S: Phase 1: Input Resolution
    S->>D: Read source document
    S->>S: Auto-detect format (hybrid)
    Note over S: Phase 2: First-Principles Extraction
    S->>S: Extract Root Problem (5-Why)
    S->>S: Extract Assumptions Register
    S->>S: Build Reasoning Chain
    S->>S: Build Alternative Rejection Log
    S->>S: Build Decision Sensitivity
    S->>S: Identify Open Unknowns
    Note over S: Phase 3: Output Assembly
    S->>O: Write *-fp-brief.md
    alt --verify codex
        S->>X: Independent reasoning verification
        X-->>S: Verification Delta
        S->>O: Append Verification Delta section
    end
    S-->>U: Report complete
```

### 3.2 Skill File Structure

```
skills/fp-brief/
  SKILL.md                          # Skill definition
  references/
    output-template.md              # 7-section output template with depth matrix
    detection-rules.md              # Format auto-detection rules
    extraction-guide.md             # Section-by-section extraction heuristics
    codex-verify-prompt.md          # Codex verification prompt template (--verify codex)
```

### 3.3 Command Signature

```
/fp-brief <doc-path> [--depth brief|normal|deep] [--verify off|codex] [--output <path>] [--no-save]
```

| Flag | Default | Description |
|------|---------|-------------|
| `<doc-path>` | Required | Source markdown document path |
| `--depth` | `normal` | Output detail level |
| `--verify` | `off` | Independent Codex reasoning check |
| `--output` | Same dir, `-fp-brief.md` suffix | Custom output path |
| `--no-save` | false | Print to stdout instead of file |

### 3.4 Core Logic

#### Phase 1: Input Resolution

```
1. Validate input path:
   - Normalize path (resolve symlinks, reject `..` traversal)
   - Reject paths outside repo root (`git rev-parse --show-toplevel`)
   - If validation fails → abort with error
2. Read source document
3. Redaction scan (fail-safe):
   - Scan source document for patterns matching secrets (API keys, tokens, passwords per @rules/security.md)
   - High-confidence match (e.g., `sk-...`, `ghp_...`, `-----BEGIN PRIVATE KEY-----`) → abort with error, do not produce output
   - Medium-confidence match → mask pattern in output (`[REDACTED]`), emit warning
   - No match → proceed normally
4. Auto-detect format (hybrid strategy, deterministic priority):

   | Priority | Method | Match | Result | Confidence |
   |----------|--------|-------|--------|------------|
   | 1 | Path pattern | `docs/features/*/2-tech-spec.md` | tech-spec | high |
   | 2 | Path pattern | `docs/features/*/0-feasibility-study*.md` | feasibility-study | high |
   | 3 | Path pattern | `docs/features/*/requests/*.md` | request-doc | high |
   | 4 | Content heading | Has "## Technical Solution" or "## Architecture" | tech-spec | medium |
   | 5 | Content heading | Has "## Acceptance Criteria" | request-doc | medium |
   | 6 | Content heading | Has "## Possible Solutions" or "## Recommendation" | feasibility-study | medium |
   | 7 | Fallback | None matched | unknown | low |

   Tie-break: first match wins (priority order). Output header shows detected format + confidence.
5. Select extraction template based on detected format
```

#### Phase 2: First-Principles Extraction

每個 section 的提取邏輯：

| Section | Extraction Strategy |
|---------|-------------------|
| **Root Problem** | 從文件的 Problem/Goals/Requirements section 反向推導 5-Why。不是複製問題描述，而是追問「為什麼這個問題重要？為什麼現有方案不夠？」直到觸及不可再分的基本真理 |
| **Assumptions Register** | 掃描文件中所有隱含的前提條件（「假設 X 成立」「基於 Y」「由於 Z 限制」）。每個 assumption 標註來源 section 和置信度 |
| **Reasoning Chain** | 建構 Principle → Constraint → Decision 的因果鏈。每個決策追溯到具體的原理或假設，並引用來源文件的 section heading |
| **Alternative Rejection Log** | 從文件的方案比較、rejected proposals、或隱含的「我們沒有選 X 因為...」中提取。每個被拒方案標註拒絕原因（from first principles） |
| **Decision Sensitivity** | 對 Assumptions Register 中的每個 assumption，分析「如果此假設不成立，哪些 Reasoning Chain 中的決策會受影響？」產出 assumption → affected decisions mapping |
| **Open Unknowns** | 從文件的 Open Questions、Risks、或推理過程中發現的未解問題彙整。區分「已知的未知」和「推理過程中新發現的未知」 |

#### Long Document Strategy

對於超長文件（>500 lines），採用分段處理：

```
1. Split document by top-level headings (## sections)
2. Extract per-section: assumptions, decisions, alternatives
3. Merge extracted items into unified registers (dedup by content)
4. Build cross-section reasoning chain
```

此策略避免在 deep mode 下因 token 限制導致截斷。

#### Phase 3: Output Assembly

```
1. Apply depth filter (section inclusion matrix)
2. Apply source citation format (reference source doc section headings)
3. Write output file (or stdout if --no-save)
4. If --verify codex: dispatch Codex verification (Phase 4)
```

#### Phase 4: Optional Codex Verification (`--verify codex`)

遵循 `codex-invocation.md` 規則（mandatory fields，非 optional）：

**Required prompt fields**（per `codex-invocation.md` enforcement checklist）：
- Prompt 包含 "independently research" section
- Prompt 包含具體 git/grep/cat 指令
- Prompt 不包含 Claude 的分析結論
- `sandbox: 'read-only'` + `approval-policy: 'never'`

```
mcp__codex__codex({
  prompt: `You are a senior reasoning auditor. Independently verify
the first-principles briefing against its source document.

## Files
- Source document: ${SOURCE_PATH}
- FP-Brief output: ${OUTPUT_PATH}

## Independent Research (mandatory)

### Git Exploration (Priority)
1. Check change status: \`git status\`
2. Check changed files: \`git diff --name-only HEAD\`
3. Check full changes: \`git diff HEAD -- ${SOURCE_PATH}\`

### Document Reading
4. Read source: \`cat ${SOURCE_PATH}\`
5. Read briefing: \`cat ${OUTPUT_PATH}\`

### Project Research
6. Search for referenced modules: \`grep -r "keyword" skills/ -l | head -10\`
7. Verify referenced files exist: \`ls <path>\`
8. Read related files: \`cat <file-path> | head -100\`

## Verification Dimensions
1. Root Problem: Does the 5-Why decomposition reach an irreducible truth?
2. Assumptions: Are there assumptions in the source doc NOT captured in the register?
3. Reasoning Chain: Are there logical jumps (decision without traced principle)?
4. Decision Sensitivity: Are there missing assumption→decision links?
5. Completeness: Are there important source sections not reflected?

## Output
Verification Delta table (aspect / Claude assessment / Codex assessment / delta)`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

### 3.5 Output Template

#### Depth Matrix

| # | Section | brief | normal | deep |
|---|---------|:-----:|:------:|:----:|
| 1 | Root Problem | Full | Full | Full |
| 2 | Assumptions Register | Top 3 | Full list | Full + challenge questions |
| 3 | Reasoning Chain | Summary (key decisions only) | Full chain with citations | Full + evidence strength rating |
| 4 | Alternative Rejection Log | — | Full | Full + deeper counterfactual analysis |
| 5 | Decision Sensitivity | Top 3 sensitive decisions | Full mapping | Full + sensitivity matrix table |
| 6 | Open Unknowns | — | Full | Full + risk-weighted prioritization |
| 7 | Verification Delta | — | Only if `--verify codex` | Only if `--verify codex` |

#### Length Policy

| Depth | Max Length | Minimum Evidence Rule |
|-------|-----------|----------------------|
| brief | ~500 words (upper bound, not target) | Each included section must cite at least 1 source section |
| normal | ~1500 words (upper bound) | Each section must cite at least 1 source section |
| deep | ~2500 words (upper bound) | Each section must cite at least 2 source sections |

**Evidence Insufficient Rule**: 如果來源文件的內容不足以填充某個 section，必須輸出 `[Evidence insufficient — source doc lacks data for this section]` 而非產生推測性內容。長度上限是 cap，不是必須達到的目標。

### 3.6 Output Format

```markdown
# First-Principles Briefing: <document title>

> Source: <relative path to source doc>
> Depth: brief | normal | deep
> Format detected: tech-spec | feasibility-study | request-doc | unknown
> Generated: <ISO 8601 timestamp>

## 1. Root Problem

### Surface Problem
<what the document says the problem is>

### First-Principles Decomposition
1. Why: <first why> → <answer>
2. Why: <second why> → <answer>
3. ...

### Fundamental Truth
> <irreducible core problem statement>

## 2. Assumptions Register

| # | Assumption | Source Section | Confidence | If Wrong... |
|---|-----------|---------------|------------|-------------|
| A1 | ... | §3.1 Architecture | High | ... |
| A2 | ... | §4 Risks | Medium | ... |

## 3. Reasoning Chain

### Decision D1: <decision name>
- **Principle**: <fundamental truth or constraint>
- **Reasoning**: <because P, and given constraint C, therefore D>
- **Source**: §<section reference>

### Decision D2: ...

## 4. Alternative Rejection Log

| # | Alternative | Rejected Because | First-Principle Basis |
|---|-----------|-----------------|----------------------|
| R1 | ... | ... | Violates assumption A1 |

## 5. Decision Sensitivity

| Assumption | If Wrong → Affected Decisions | Impact |
|-----------|------------------------------|--------|
| A1 | D1, D3 | High — core architecture changes |
| A2 | D2 | Low — only affects timeline |

## 6. Open Unknowns

| # | Unknown | Source | Risk Level | Suggested Resolution |
|---|---------|--------|------------|---------------------|
| U1 | ... | Inferred from reasoning | High | ... |

## 7. Verification Delta (optional, --verify codex only)

| Aspect | Claude Assessment | Codex Assessment | Delta |
|--------|------------------|------------------|-------|
| Root Problem depth | ... | ... | ... |
| Missing assumptions | ... | ... | ... |
| Reasoning gaps | ... | ... | ... |
```

## 4. Risks and Dependencies

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| 來源文件太薄，產出看似嚴謹但實際空洞 | Medium | High | 加入 confidence indicator：基於來源文件的 section 數量和內容豐富度評分；低於閾值時輸出警告 |
| 使用者混淆 `/fp-brief` 和 `/project-brief` | Low | Medium | SKILL.md 的 "When NOT to Use" 明確區分；trigger keywords 不重疊 |
| Decision Sensitivity 難以自動化良好 | Medium | Medium | v1 採用簡單格式（assumption → affected decisions）；不追求量化指標 |
| `--verify codex` 增加延遲和成本 | Low | Low | Default off；使用者主動選擇 |
| Auto-detect 誤判格式 | Low | Low | Fallback 到 generic extraction；output header 顯示偵測結果供使用者確認 |

| Dependency | Type | Status |
|-----------|------|--------|
| `codex-invocation.md` rules | Rule | Exists |
| `codex-explain` depth pattern | Convention | Exists |
| `project-brief` suffix convention | Convention | Exists |
| Feature context resolution | Code | Exists (`scripts/lib/feature-resolver.js`) |

## 5. Work Breakdown

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| W1 | 建立 `skills/fp-brief/SKILL.md` | 2h | None |
| W2 | 建立 `skills/fp-brief/references/output-template.md` | 1h | W1 |
| W3 | 建立 `skills/fp-brief/references/detection-rules.md` | 1h | W1 |
| W4 | 建立 `skills/fp-brief/references/extraction-guide.md` | 1.5h | W2 |
| W5 | 建立 `commands/fp-brief.md` command definition | 1h | W1 |
| W6 | 更新 `CLAUDE.md` command quick reference | 30m | W5 |
| W7 | 建立測試案例（對已有 tech spec 執行驗證） | 1h | W1-W5 |
| W8 | Codex verification prompt template (`references/codex-verify-prompt.md`) | 1h | W1, W4 |

**Total**: ~9-10h

## 6. Testing Strategy

### Validation Approach

由於此 skill 無程式碼（純 SKILL.md + references），測試以「對已有文件執行並驗證輸出品質」為主：

| Test Type | Method | Acceptance Criteria |
|-----------|--------|-------------------|
| Smoke test | 對 `docs/features/seek-verdict/2-tech-spec.md` 執行 `/fp-brief` | 產出 7 section 結構完整的 `-fp-brief.md` |
| Depth test | 分別用 `--depth brief/normal/deep` 執行 | brief 不超過 ~500 words, normal 不超過 ~1500 words, deep 不超過 ~2500 words |
| Format detection | 對 tech-spec, request-doc, unknown 格式各執行一次 | 正確偵測格式類型 |
| Citation test | 檢查 Reasoning Chain 是否引用來源 section | 每個 Decision 有 `Source: §<ref>` |
| Sensitivity test | 檢查 Decision Sensitivity 是否合理 | 每個 assumption 至少對應一個 decision |
| Edge case: thin doc | 對內容極少的 `.md` 執行 | 顯示 `[Evidence insufficient]` markers，不產出空洞內容 |
| Edge case: long doc | 對 >500 lines 的文件執行 | 分段處理正常完成，無截斷 |
| Format fallback | 對非標準路徑的 `.md` 執行（如 `notes/design.md`） | 正確 fallback 到 `unknown`，generic extraction 仍產出有意義內容 |
| Security: path | 嘗試 `../../../etc/passwd` 路徑 | 拒絕並顯示 repo boundary 錯誤 |
| Request doc | 對 `docs/features/*/requests/*.md` 執行 | 正確偵測為 request-doc，提取 AC-based reasoning |

### Review Gate

| Gate | Requirement |
|------|------------|
| `/codex-review-doc` | SKILL.md 和 references 品質 |
| `/skill-health-check` | Routing accuracy, progressive loading |

## 7. Open Questions

- [x] **Q1**: `--verify codex` 的 prompt 是否需要獨立的 reference 檔案？→ **是**，W8 為 required deliverable，存放於 `references/codex-verify-prompt.md`
- [x] **Q2**: 是否需要 `--lang` flag 來控制輸出語言？→ **不需要**，語言由當前會話/使用者指示決定（per `docs-writing.md` locale rules），非硬編碼預設
- [ ] **Q3**: 是否支援 batch mode（同時處理多個文件）？（初步判斷：v1 不支援，inline 執行即可）
- [ ] **Q4**: 產出的 `-fp-brief.md` 是否要加入 feature doc numbering（如 `5-fp-brief.md`）？（初步判斷：不需要 — fp-brief 是衍生物，不是 phase artifact）
- [ ] **Q5**: Decision Sensitivity section 是否需要更嚴格的評估框架（如量化 impact score）？（初步判斷：v1 用 High/Medium/Low 即可）

## Appendix: Workflow Positioning

```
/feasibility-study → /tech-spec → /deep-analyze → [implementation] → /fp-brief
    (pre-doc)         (create)     (deepen)         (build)          (explain why)
                                                        |
                                                /project-brief (PM/CTO)
                                                /fp-brief (technical audience)
```

## Appendix: Debate Record

此技術規格基於 `/best-practices` audit + `/codex-brainstorm` adversarial debate 的結果。

- **Debate threadId**: `019d1db8-fcaf-7ca0-b368-8c1ae73792fc`
- **Equilibrium**: Pure Strategy（3 rounds）
- **Key convergence points**:
  1. Standalone skill（非 project-brief 擴展）— 目標 audience 和 output 根本不同
  2. Optional Codex verification（default off）— synthesis task 不需要 default verification
  3. Any markdown input + hybrid auto-detection — 不做格式限制
  4. Decision Sensitivity 為核心差異化 section — 現有工具無此能力
