# Tech Spec: Workflow Orchestration v1 — Report-only `/orchestrate`（Option C 兩平面）

> **Doc class**: Lifecycle — Phase 2 tech spec（依 `@rules/docs-numbering.md`）。
> **Created**: 2026-06-12
> **Requirements**: [1-requirements.md](./1-requirements.md)
> **Feasibility**: [0-feasibility-study.md](./0-feasibility-study.md)（Option C two-plane 決策，v1 report-only）

## 1. Requirement Summary

### 1.1 Problem

近百個 skill（執行期以 `docs/skill-catalog.yml` 為準，as-built 98 筆 command entries，含 `/orchestrate` 自身）的編排決策 100% 人工（人腦 + `CLAUDE.md` 流程表）。需要「宣告意圖 → agent 自動推導計畫 → 預覽 → 受控執行」的能力，**且不可繞過 hook 強制的安全 gate**（feasibility §1 核心張力）。

### 1.2 Goals（v1）

| # | Goal | 來源 |
|---|------|------|
| G1 | `/orchestrate` skill：意圖 + 約束 + budget + 完成定義 → planner agent 產出**隨 repo 狀態變動**的 workflow 計畫 | FR-1/FR-2、SC-1 |
| G2 | 計畫可預覽（plan preview）；執行前經人核可（human gate） | FR-3、NFR-1 |
| G3 | **Report-only 執行**：fanout worker 一律 read-only（deny-by-default admission）；唯一 **user-facing repo 內容 mutation** = 主 session `Write` 報告（走既有 doc hook + `/codex-review-doc`）。control-plane run-state 寫入為 gitignored bookkeeping、對 safety plane 惰性（§3.2） | FR-4、NFR-1、feasibility §7 |
| G4 | 兩平面分離：control-plane run-state（`.claude_workflows/<run-id>.json`）獨立於 hook 獨佔的 safety plane（`.claude_review_state.json`，orchestrator 只讀不寫） | feasibility Option C |
| G5 | Pre/post 無變更驗證（HEAD/branch/worktree/porcelain+content hash），任一變動 → fail-closed | SC-2 |
| G6 | 新 skill 進 `docs/skill-catalog.yml` 即自動成為規劃候選，不改編排核心 | FR-11、SC-5 |
| G7 | 三種編排形狀：循序 / 平行 / 重複直到收斂（wave + 完整性 gate） | FR-5 |

### 1.3 Non-Goals（v1 明確排除）

| 排除 | 理由 / 去處 |
|------|------------|
| Mutation 編排（worker 改檔） | 護欄未齊（strict preflight、Bash mutation detector、tamper protection、Spike 2/3）——見 feasibility §7 護欄 (1)-(7)、§7 OQ |
| 為全部 catalog skills + agents 補 `mutation:` metadata | Spike 3（~2-3 人日），v2 前置 |
| Hook 端強制（orchestrate 專屬 hook / sentinel 解析） | v1 純行為層 + scripted lint；不動任何 hook（SC-4 零回歸的最強保證） |
| 跨 session 編排 / 多人協作 | requirements Non-Goals |
| `safety_epoch` + CAS | feasibility §8 OQ，v2 |

## 2. Existing Code Analysis

### 2.1 Related Modules

| Module | 角色 | 證據 |
|--------|------|------|
| `docs/skill-catalog.yml` | 規劃候選的單一來源（as-built 98 筆 command entries；欄位 `command`/`category`/`featured`/`public`，**`use_when` 為選填**——目前僅 19 筆有）。候選描述不足時以 SKILL.md frontmatter `description` 補（同 `scripts/generate-readme-catalog.js` 的讀取模式）；**數字以執行期讀取為準，本表僅 snapshot** | 檔案本身；`/update-readme` 由它產 README catalog |
| `agents/*.md`（15 個） | fanout worker 候選；frontmatter `tools:` 為 admission 訊號之一（**不可單獨信任**，見 feasibility §3.3） | `agents/performance-optimizer.md:4`（純 `Read,Grep,Glob`）等 |
| `skills/deep-explore/SKILL.md` | 可重用 fanout 模式：wave（2-3 agent × ≤2-3 wave）、80/20 contract、context packet、完整性 gate | `SKILL.md` Wave 1/Inter-Wave 區段 |
| `skills/next-step/scripts/analyze.js` | repo 狀態信號（phase + findings）——planner 輸入的現成來源 | `analyze.js`（17 條 findings 規則） |
| `hooks/post-edit-format.sh` | Safety plane 寫入者。**關鍵事實**：change-flag 分類 regex——code 副檔名集（ts/tsx/js/…/sh/bash/zsh）與 doc 副檔名集（md/mdx）——**`.json`/`.yml` 皆不在內**，故 run-state 檔經 `Write` 寫入不觸發任何 flag | `post-edit-format.sh`（code/doc 分類 regex；引用符號語意非行號） |
| `hooks/stop-guard.sh` | 單向 true→false reconciliation（`-uall`）：**untracked 且未 gitignore 的檔會讓 worktree 永不乾淨** → run-state 目錄必須 gitignore | `stop-guard.sh`「Stale-state git check」 |
| `scripts/run-skill.sh` + `test/scripts/next-step-analyze.test.js` | skill script 執行與測試慣例（`skills/<name>/scripts/*.js` → `test/scripts/<name>-<script>.test.js`） | 檔案本身 |

### 2.2 可重用 / 需新建

| 資產 | 動作 | 用途 |
|------|------|------|
| `skills/orchestrate/SKILL.md` + `references/` | **New** | 編排主流程 + planner prompt 模板 + plan schema + 執行政策 |
| `skills/orchestrate/scripts/plan-context.js` | **New** | 確定性組裝 planner 輸入（catalog + agents + repo 信號 + admission + budget fail-closed） |
| `skills/orchestrate/scripts/validate-plan.js` | **New** | Plan lint = v1 admission controller（deny-by-default + gate 完備性 + why 必填 + v1 禁 mutating 執行） |
| `skills/orchestrate/scripts/run-verify.js` | **New** | pre/post 無變更驗證（snapshot / compare） |
| `skills/orchestrate/references/admission-allowlist.json` | **New** | Fanout-eligible 名單（curated，deny-by-default） |
| `skills/orchestrate/scripts/prune-runs.js` | **New** | FIFO 保留策略的可執行實作（`<run-id>.json` 與同名目錄一起算、一起刪；containment：root 須為真實 `.claude_workflows` 目錄、非 symlink，認不得的檔名保留並回報）。散文規則無從執行，所以 FIFO 有一支可執行的實作。**但這不是能力邊界，是規範路徑**：`allowed-tools` 雖未預先核可 `Bash(rm:*)`，卻預先核可了 `Bash(node:*)`，而那同樣涵蓋 `node -e 'fs.rmSync(…)'`——任何呼叫端都能繞過本腳本刪除任意路徑，沒有任何機制強制它走這裡。腳本內部的 containment（root 須為真實 `.claude_workflows` 目錄、非 symlink、每次刪除前重驗 root identity）在**走這條路時**是紮實的；要求走這條路則靠 review，不靠權限。真正的能力邊界需要 command-specific 的權限或 wrapper（v2） |
| `.gitignore` | **Modify** | 加 `.claude_workflows/` |
| `docs/skill-catalog.yml` / CLAUDE quick-ref ×3 | **Modify** | `/orchestrate` 登錄（planning category） |
| `test/scripts/orchestrate-*.test.js` + `test/skills/orchestrate.test.js` | **New** | §6 測試映射 |
| Hooks（全部） | **不動** | v1 零 hook 變更（SC-4） |

### 2.3 既有約束（已驗證，from feasibility）

| 約束 | 對設計的影響 |
|------|-------------|
| `allowed-tools` 不可信任為 read-only 判據 | admission 用 curated allowlist（明確列舉 + 理由），非 frontmatter 推導 |
| `Bash` 改檔不設 change flag | fanout worker 即使 allowlisted 仍可能經 Bash 改檔 → **pre/post 驗證是硬後盾**（雙層防禦） |
| stop-guard 預設 warn | v1 report-only 不依賴 strict；mutating 編排（v2）才需 strict preflight |
| DW（`Workflow` 工具）為付費 research preview | DW 為可選 backend；不可用時退回 background `Agent`（≤3 並行），admission 同一套 |
| compaction 後 `post-compact-auto-loop.sh` 不知 workflow 狀態 | run-state 寫入磁碟 + `--resume <run-id>`；hook 整合列 v2 OQ |

### 2.4 已驗證事實（撰寫時 spot-check，引用符號語意為準）

| 主張 | 狀態 |
|------|------|
| `post-edit-format.sh` code 分類 regex 不含 `.json`/`.yml`；doc 分類僅 `.md`/`.mdx` | ✅ 已驗證（兩段分類 regex） |
| `stop-guard.sh` reconciliation 用 bounded `-uall`（untracked 未 gitignore 會讓 worktree 永不乾淨） | ✅ 已驗證 |
| `agents/performance-optimizer.md` `tools: Read, Grep, Glob`；`coverage-analyst` 含 `Bash(find:*)`；`git-investigator` 含 `Bash(git:*)` | ✅ 已驗證（frontmatter） |
| ~~`.gitignore` 目前**無** `.claude_workflows/`（W4.4 為 hard precondition）~~ | ⛔ **已過期**：W4.4 已完成，`.gitignore:10` 現含 `.claude_workflows/`。此列記錄的是撰寫當下的前置條件，非現況 |
| skill script 測試慣例 `test/scripts/<skill>-<script>.test.js` | ✅ 已驗證（`next-step-analyze.test.js`） |

## 3. Technical Solution

### 3.1 Architecture（兩平面）

```mermaid
flowchart TB
    subgraph CP["Control Plane（新增，v1）"]
        I[意圖 + 約束 + budget] --> PC[plan-context.js<br/>確定性輸入組裝]
        PC --> SNAP1[run-verify.js snapshot<br/>baseline——先於任何 agent 派發]
        SNAP1 --> PL[Planner agent（Explore，<br/>admission 約束）背景派發]
        PL --> CMP1[run-verify.js compare --baseline-sha256<br/>planning 後立即驗，drift → fail-closed]
        CMP1 --> VP[validate-plan.js<br/>admission + gate lint]
        VP --> PV[Plan preview<br/>AskUserQuestion 核可]
        PV -->|approve + --execute| FO[Read-only fanout<br/>Workflow 工具 或 Agent ≤3]
        FO --> SNAP2[run-verify.js compare --baseline-sha256<br/>同一 baseline 與 digest，fail-closed]
        SNAP2 -->|無變更| RPT[主 session Write 報告]
        SNAP2 -->|有變更| NH["⚠️ Need Human（fail-closed）"]
        RPT --> DG{doc review gate<br/>詳見 §3.4}
        DG -->|"✅ Mergeable"| DONE[run 標 done]
        DG -->|"⛔ / degraded"| NH2[run 標 needs_human]
        RS[(".claude_workflows/&lt;run-id&gt;.json"<br/>run-state，gitignored)]
        PV -.-> RS
        FO -.-> RS
        RPT -.-> RS
    end
    subgraph SP["Safety Plane（既有，hook 獨佔，v1 零變更）"]
        H[post-edit-format.sh] --> SF[(".claude_review_state.json")]
        SG[stop-guard.sh] --> SF
    end
    RPT -->|".md Write 觸發 doc hook"| H
    RPT --> DR["/codex-review-doc（既有 auto-loop）"]
    CP -.->|只讀，永不寫| SF
```

**平面互動規則**（NFR-4 / SC-4 的設計核心）：

| 規則 | 說明 |
|------|------|
| Orchestrator 對 safety plane **只讀** | 不寫 `.claude_review_state.json`、不偽造 `has_*_change` / `*.passed`、不 emit 任何 hook-parsed sentinel |
| 唯一進入 safety plane 的路徑 = 主 session `Write` 報告 | `.md` Write → `post-edit-format.sh` 設 `has_doc_change` → 既有 `/codex-review-doc` auto-loop 接手（**刻意重用，不是繞過**） |
| run-state 不污染 safety plane | `.json` 不在 code/doc 分類 regex 內（§2.1 已驗證）→ `Write` run-state 不設任何 flag；目錄 gitignore → `-uall` reconciliation 看不到 |
| v1 不動任何 hook | Signal 4（零回歸）由「無 diff」保證，而非「diff 後測試通過」 |

### 3.2 Data Model — run-state（control plane 獨有）

**檔案**：`.claude_workflows/<run-id>.json`（gitignored；`run-id` = `<UTC yyyymmdd-HHMMSS>-<intent-slug>`，主 session 產生）

```jsonc
{
  "schema_version": 1,
  "run_id": "20260612-093000-audit-hook-failopen",
  "created_at": "2026-06-12T09:30:00Z",
  "updated_at": "2026-06-12T09:42:10Z",
  "intent": "audit 全 repo hook 的 fail-open 路徑",
  "done_definition": "報告涵蓋全部 7 個 state-touching hook，每項判定附 file:line 證據",
  "budget_tier": "M",                          // S | M | L（§3.3 T1）
  "status": "reporting",                        // planning | awaiting_approval | executing | verifying | reporting | done | needs_human | failed | aborted
                                                // done 的唯一路徑：報告之 /codex-review-doc 回 ✅ Mergeable；
                                                // ⛔ / degraded / 無法判定 → needs_human（不得標 done）
  "baseline": {                                 // run-verify.js snapshot 輸出（欄位集 = T3 檢查項，缺一不可）
    "schema_version": 4,                        // 記錄本身的版本，非 repo 狀態：compare 對它做
                                                //「不相等即硬性拒絕」，不列入 drift 比對
    "head": "3be3372…", "branch": "main",
    "porcelain_sha256": "ab12…",                // git status --porcelain -uall 的 hash（狀態+路徑面）
    "tracked_diff_sha256": "9a8b…",             // git diff HEAD --binary 的 hash（已 dirty tracked 檔的內容面）
    "tracked_modes_sha256": "b7e1…",            // tracked 檔案與其祖先目錄的 mode（`st.mode & 0o7777`）——git 只記錄 exec bit，`chmod 666` 檔案／`chmod 777` 目錄在 porcelain 與 diff 都是 byte-identical，此面補上其餘權限位
    "untracked_content_sha256": "7c6d…",        // untracked（--exclude-standard）檔案 path+blob hash 的 hash（內容面）
    "untracked_dirs_sha256": "c8f2…",           // untracked（非 ignored）目錄節點的存在性 + mode（ls-files --others --directory）——`porcelain -uall` 不列目錄、檔案層列舉只給葉節點，故空目錄的建立／刪除／chmod 原本三面皆盲；排除規則同 ignored_dirs
    "ignored_content_sha256": "5e4f…",          // gitignored 檔案（.env、產出物…）內容的 hash——porcelain 與 ls-files --exclude-standard 皆盲；排除 harness/control/safety 面與 node_modules/。**node_modules 不在 `IGNORED_EXCLUDE_PREFIXES` 裡**（那會讓一個名為 `node_modules` 的普通 ignored *檔案* 走到 directory 分支而被誤排除，即已記錄的 iter-21 fail-open）；實際靠三個機制：`isControlPlaneIgnored` 的 depth-anchored 分支、git 層的 `IGNORE_EXCLUDE_PATHSPECS`、以及只作用於目錄節點的 `isNodeModulesDirNode`
    "ignored_dirs_sha256": "3a2b…",             // ignored 目錄節點的存在性 + mode（ls-files --directory）——補上「空目錄」這個內容 hash 看不見的維度；同樣排除 build/dist/.venv（**僅 top-level**，`isVolumeExcludedDir` 是 root-anchored；巢狀如 `packages/*/dist/` 是已記錄的殘餘）與 node_modules（**任意深度**，`**/node_modules/**` + `isNodeModulesDirNode`）
    "refs_sha256": "cd34…",                     // git for-each-ref 全 refs 的 hash（tag/ref 面）
    "local_config_sha256": "ef56…",             // git config --list --local 的 hash
    "git_internals_sha256": "a1b2…",            // .git/hooks/*（內容+執行位）+ .git/info/exclude 的 hash（porcelain/ls-files 皆盲的 .git 內部面）
    "worktrees": ["/Users/…/sd0x-dev-flow"],
    "stash_count": 0
  },
  "plan": { "steps": [ /* §3.3 T2 plan schema */ ] },
  "steps_status": { "s1": "done", "s2": "running", "s3": "pending" },
  "replan_count": 0,                            // FR-9：上限 1（v1）
  "evidence": [ { "step": "s1", "summary": "…", "refs": ["hooks/stop-guard.sh:147"] } ],
  "report_path": null                           // 完成後填報告路徑
}
```

| 設計點 | 理由 |
|--------|------|
| `Write` 工具寫入（非 Bash heredoc） | `.json` 不觸發 change flag（§2.1 驗證）；保留 transcript 可見性；不違 Bash-mutation 顧慮（這是主 session 受監看的工具呼叫） |
| 一 run 一檔，FIFO 保留最近 10 個 run | 可重入（NFR-6）；舊 run 可查（NFR-2）；清理走 `scripts/prune-runs.js`（`<run-id>.json` + 同名目錄成對計數與刪除，超過 10 個刪最舊） |
| 寫入磁碟前過 `security-redact.js` **完整 contract**：`scanHighConfidence` truthy → **abort fail-closed**（不寫檔、run 標 `needs_human`、提示改寫意圖）；medium → mask 後寫入 | 意圖/完成定義為自由文字，可能含貼上的 secret（R8）；沿 plan-review 既有 redaction 語意，禁用 medium-mask-only 弱化版 |
| `steps_status` 與 `plan` 分離 | resume 時 plan 不可變、status 可變——重跑冪等（read-only worker 無副作用） |
| 無任何 safety 欄位 | 兩平面分離的 schema 級保證——review/precommit 狀態**只**存在 safety plane |

### 3.3 API Design（4 個 scripts + 1 個 skill）

#### T1 — `plan-context.js`（確定性輸入組裝，Signal 1/5 的自動化錨點）

```
node skills/orchestrate/scripts/plan-context.js --out <path> [--budget S|M|L] [--catalog <path>] [--agents-dir <path>] [--allowlist <path>]
```

`--out` 為**必要**：封包寫入指定路徑，stdout 只回摘要（~0.5 KB）。舊的「整包走 stdout」契約已淘汰——內嵌封包會在主 session 造成 ~81 KB × 2 的雙份注入（Bash 結果一份 + planner prompt 一份，且前者留存整段對話）。`--out` 寫入失敗即 exit 1（fail-closed），不得退回 stdout。

**stdout 摘要欄位**：`schema_version` / `context_path` / `bytes` / `sha256` / `budget` / `admission` / `counts`。其中 `sha256` 是封包內容的 digest，必須原樣傳給 `validate-plan.js --context-sha256`（見 T2）。

| 封包欄位（寫入 `--out` 檔案） | 內容 | 來源 |
|------------------------|------|------|
| `skill_candidates[]` | `{command, category, featured, public, use_when?, description}` 全 catalog 條目；`use_when` 選填，缺漏時以 SKILL.md frontmatter `description` 補位（同 `generate-readme-catalog.js` 讀取模式） | `docs/skill-catalog.yml` + `skills/*/SKILL.md`（**執行期讀取** → 新 skill 自動納入，FR-11/SC-5） |
| `agent_candidates[]` | `{name, tools, fanout_eligible, deny_reason?}` | `agents/*.md` frontmatter + allowlist 比對 |
| `repo_signals` | `{branch, head, dirty_files_count, features[]（docs/features/ 目錄列表 + 各自有哪些 lifecycle docs）}` | `git` + `fs`（Signal 1：計畫隨現況變動的素材） |
| `budget` | `{tier, max_workers, max_waves, max_plan_steps, max_context_bytes}` | tier 表（下） |
| `admission` | `{mode: "deny-by-default", allowlist: [...]}` | `references/admission-allowlist.json` |

| Budget tier | max_workers | max_waves | max_plan_steps | max_context_bytes |
|------------|:-----------:|:---------:|:--------------:|:-----------------:|
| S | 2 | 1 | 8 | 64 KiB |
| M | 3 | 2 | 15 | 128 KiB |
| L | 4 | 3 | 25 | 256 KiB |

**Fail-closed（NFR-3）**：組裝後輸出若超過 `max_context_bytes` → **exit 1 + 明確錯誤**（列出超量來源，建議升 tier 或縮範圍），絕不靜默截斷。catalog/agents 目錄缺失、YAML/frontmatter 解析失敗、**或 admission allowlist 檔缺失/解析失敗 → 一律 exit 1**（不產生部分候選；缺 allowlist 是設定錯誤，不以「全拒但繼續」弱化——單一 fail-closed contract）。

#### T2 — Plan schema + `validate-plan.js`（v1 admission controller）

Planner agent 輸出的計畫必須符合此 schema（`references/plan-schema.md` 為正典，此處節錄）：

```jsonc
{
  "intent": "…", "done_definition": "…",
  "steps": [{
    "id": "s1",
    "kind": "fanout | main-skill | verify | gate | proposed-manual",
    "target": "Explore | performance-optimizer | /codex-review-doc | …",
    "why": "必填（NFR-2/Signal 6）：為何選此 skill/agent",
    "parallel_group": "w1",                  // 同 group = 平行（FR-5 平行）
    "depends_on": ["s0"],                    // 循序（FR-5 循序）
    "converge": { "max_rounds": 2, "until": "completeness gate 描述" },  // FR-5 收斂（選填）
    "preconditions": ["docs/features/x/2-tech-spec.md 存在"],            // FR-6
    "done_criteria": "…",                                                // FR-6
    "mutating": false                        // planner 自評；validate-plan.js 複核 kind 一致性
  }],
  "stop_conditions": ["budget 用盡", "post-verify 偵測變更"],
  "required_gates": ["doc-review"]           // change-type → gate 映射結果
}
```

```
node skills/orchestrate/scripts/validate-plan.js --plan <path|-> --context <封包路徑> --context-sha256 <摘要的 sha256>
```

`--context-sha256` 為**無條件必要**參數（含 `--context -`），省略即 exit 1。理由：封包落在 `.claude_workflows/`，而 `run-verify.js` 刻意把該路徑排除在 drift 偵測之外、且具 Bash 能力的 planner 可寫入該檔——沒有 digest 綁定，planner 可以竄改 `admission.allowlist`（繞過 A1）或捏造 `skill_candidates`（繞過 A4），交出與竄改後封包一致的 plan，然後乾淨通過驗證且無任何 drift 紀錄。digest 由 `plan-context.js` 在組裝當下算出，經摘要走**主 session**（planner 觸及不到的通道）傳遞。

> 早期版本豁免 `--context -`，理由是「由 plan-context.js 在行程內管線傳入、全程不落地」。該前提不成立：`plan-context.js` 強制要求 `--out` 且沒有任何 stdout 封包分支，根本無法餵管線，所以 `--context -` 唯一到得了的路徑是 `cat <已落在 .claude_workflows/ 的檔案>`——與檔案路徑同一個 planner 可寫表面，卻把完整性檢查關掉。改為無條件要求，與 `run-verify.js --baseline-sha256`（含 `--baseline -`）一致：綁定成立與否取決於 digest 走的通道 worker 碰不碰得到，而不是位元組從哪個 fd 進來。

| Lint 規則（全部 fail-closed，違反 → exit 1 + 規則代碼） | 對應需求 |
|--------------------------------------------------------|---------|
| A1 `kind: fanout` 的 `target` 必須在 `admission.allowlist`（**deny-by-default**：不在名單 = 拒絕，不論宣告） | FR-4、feasibility admission |
| A2 `kind: fanout` 且 `mutating: true` → 拒絕（矛盾宣告） | NFR-1 |
| A3 v1 任何 `mutating: true` 步驟的 `kind` 必須是 `proposed-manual`（列入計畫、**絕不執行**，交人走正常流程） | v1 report-only |
| A4 `kind: main-skill` 的 `target` 必須存在於 plan-context `skill_candidates`（反幻覺——planner 只能選真實 skill；context 缺 `skill_candidates` 亦拒，fail-closed） | Signal 1、NFR-3 |
| G1 計畫含 code 變更類 `proposed-manual` 步驟 → `required_gates` 須含 `code-review` + `precommit`；含 `.md` 產出 → 須含 `doc-review` | Signal 2 |
| G2 v1 執行面唯一 mutation = 報告 `Write` → `required_gates` 至少含 `doc-review` | Signal 2 |
| O1 每步 `why` 非空 | Signal 6 |
| B1 `steps.length ≤ max_plan_steps`；fanout 同 group 數 ≤ `max_workers`；`converge.max_rounds ≤ max_waves`（非數值亦拒） | NFR-3 |
| S1 計畫 JSON 不含 hook-parsed sentinel 字串（`## Gate:`、bare `✅ Ready`/`✅ Mergeable`/`⛔ Blocked`/`✅ All Pass`） | 兩平面隔離 |
| SCHEMA 結構完整性：`intent`/`done_definition` 非空、`steps` 為陣列、`kind` 已知、step `id` 必填且唯一、`depends_on` 為陣列且引用存在的 id | NFR-3 |

#### T3 — `run-verify.js`（無變更驗證，SC-2 硬後盾）

```
node skills/orchestrate/scripts/run-verify.js snapshot            # stdout: baseline JSON；stderr: baseline_sha256=<hex>
node skills/orchestrate/scripts/run-verify.js compare --baseline <path|-> --baseline-sha256 <hex>   # exit 0 = 無變更；exit 1 = drift 或 digest 不符
```

**`--baseline-sha256` 為必要**。少了它，compare 證明的只是「我拿到的這份檔案與 repo 相符」——worker 在改動後重跑一次 `snapshot`，產出的檔案逐欄位完全吻合，drift 遂讀成 `ok: true`，SC-2 無變更證明形同虛設。digest 對 raw bytes 取，且在 parse 之前比對：替換要擋在身分層，不是形狀層。

信任邊界（如實陳述，不誇大）：digest 由主 session 在**任何派發之前**從 snapshot 的 stderr 取得、也由主 session 傳回 compare，fanout worker 全程接觸不到，因此擋得住 worker 平面的 baseline 替換。它**擋不住**已被接管的主 session——該層沒有任何機制擋得住，因為 `--baseline` 與 `--baseline-sha256` 兩個參數都由它決定。與 `plan-context.js --context-sha256` 同一條信任鏈。

| 檢查項 | 抓得到的 bypass | 超越 `git status --porcelain` 之處 |
|--------|----------------|-----------------------------------|
| `HEAD` sha | worker 偷 commit（worktree 仍乾淨） | porcelain 抓不到 |
| branch ref | `git checkout -b` | porcelain 抓不到 |
| `git status --porcelain -uall` SHA-256 | 改檔 / 新增 untracked（含 Bash 改檔——change flag 抓不到的那類） | 含 untracked（鏡射 stop-guard `-uall` 修復的教訓） |
| `git diff HEAD --binary` SHA-256 | **再改已 dirty tracked 檔的內容**（porcelain 行維持 `M file` 不變） | porcelain 只記狀態+路徑，不記內容 |
| untracked（`ls-files --others --exclude-standard`）path+blob hash SHA-256 | **再改既有 untracked 檔的內容**（porcelain 行維持 `?? file` 不變）；gitignored 檔（如 run-state）合法寫入不觸發 | porcelain 只記狀態+路徑，不記內容 |
| `git for-each-ref --format='%(refname)%(objectname)'` SHA-256 | **tag / branch ref / 其他 ref 的新建或移動**（HEAD/branch 檢查蓋不到的 ref 面） | porcelain 抓不到 |
| `git config --list --local` SHA-256 | **改 local git config**（含 `core.hooksPath` 竄改） | porcelain 抓不到 |
| `.git/hooks/*`（內容+執行位）+ `.git/info/exclude` SHA-256 | **植入 `.git/hooks/pre-commit`（下次 commit 觸發的 persistence payload）**；**`.git/info/exclude` 加 pattern 藏匿符合的 untracked 寫入**（porcelain 與 `ls-files --exclude-standard` 雙盲）。路徑經 `git rev-parse --git-path` 解析，worktree-safe 且涵蓋 `core.hooksPath` 改指向 | porcelain / ls-files 皆抓不到 `.git/` 內部 |
| `git worktree list --porcelain` | worker 偷開 worktree | 新攻擊面 |
| `git stash list` count | `git stash`（把變更藏起來讓 porcelain 變乾淨；stash ref 亦被 for-each-ref 覆蓋——雙重） | porcelain 抓不到 |

**Dirty-baseline 政策**：v1 **支援 dirty 起點**（本 repo 常態為開發中 dirty）——比對語意是「**無新 drift**」（snapshot 時的 porcelain/content/refs/config hash 與 compare 時逐項相等），非「必須 clean start」。既有 dirty 檔不阻擋 run；任何**新增**變化（hash 改變，含已 dirty 檔的內容再變動）即 fail-closed。

Compare 失敗（任一 drift）→ skill 標 run `failed` + 輸出 `⚠️ Need Human`（附 drift 欄位與修復指引），**不寫報告、不嘗試自動回復**（回復本身是 mutation）。宣告式外部副作用（如 Jira）：v1 fanout worker 名單**未宣告**任何外部寫入工具（無 MCP 寫入類、無 `WebFetch` POST 類），但這不等於外部副作用為 ∅——`Explore` 具備通用 `Bash`，足以呼叫已驗證的 CLI（`gh`、`aws`、`kubectl`、`curl`）或 `node -e` 發出網路請求而變更遠端系統，**而 `run-verify.js` 只觀測本地 repo 狀態，對遠端副作用完全無感**。因此正確的敘述是：外部副作用**未被驗證**，屬需宣告與審核的殘餘風險，不是已證明為零。要真正關上，需把 fanout worker 跑在停用網路的沙箱、或把具通用 Bash 的 worker 移出可執行 admission（v2 OQ）。**其他已知不在 v1 驗證範圍**：(1) repo 之外的檔案系統寫入（如 `~/.claude/`）——由 allowlist 縮窄 + worker prompt 契約管理；(2) `git update-index --assume-unchanged` / `--skip-worktree` 令 tracked 檔的內容編輯對 porcelain 與 `diff HEAD` 皆隱形（digest 未 hash `.git/index`）。兩者正面偵測列 v2 OQ（v2 須納入 stat-independent 的 index digest）。（註：packed-refs 之 ref 改指向/增刪已由 `refs_sha256` 的 `for-each-ref` 覆蓋，非缺口。）

#### T4 — `/orchestrate` skill 介面

```
/orchestrate "<意圖>" [--budget S|M|L] [--dry-run] [--execute] [--resume <run-id>] [--backend dw|agent]
```

| Flag | 行為 |
|------|------|
| （無 flag）/ `--dry-run` | 規劃 + 預覽即止（plan preview = 預設交付物，FR-3） |
| `--execute` | 預覽 + **AskUserQuestion 核可後**執行 read-only fanout → verify → 報告（NFR-1 human gate；核可不可被 session 快取假定） |
| `--resume <run-id>` | 讀 run-state → 以**原 baseline** compare：無 drift → 續跑 `pending` 步驟（read-only 冪等，NFR-6）；**有 drift → run 標 `needs_human` 並停**（fail-closed——中斷期間的變化無法歸因，不得重拍 baseline 洗白；要繼續只能開新 run = 新 baseline + 新核可）。**前提：主 session 仍持有原 `baseline_sha256`**——否則不可 resume，見下方「Resume 與 digest 綁定」 |
| `--backend` | 強制 fanout 後端；預設 auto（`Workflow` 工具可用則用，否則 background `Agent` ≤3 並行——admission 同一套，feasibility「所有後端一律 deny-by-default」） |

#### Resume 與 digest 綁定（限制，非設計缺口）

`compare` 無條件要求 `--baseline-sha256`，而該 digest 只在 `snapshot` 的 **stderr** 出現一次；run-state 存的是 baseline **物件本身**，不存它的 digest——這是刻意的。run-state 落在 `.claude_workflows/`，與 baseline 同一個控制面；把 digest 存在旁邊，等於讓攻擊者同時改兩個檔案就能自洽，綁定退化成「跟我手上這份檔案比對」，正是 `--baseline-sha256` 要擋的東西。

因此 digest 的唯一保存處是**主 session 的對話脈絡**（worker 碰不到的通道）。由此得出可 resume 的條件：

| 情境 | 可否 resume |
|------|------------|
| 同一 session，脈絡中仍有 `baseline_sha256=<hex>` | ✅ 照上表流程 |
| 中斷、compaction 後脈絡遺失、或換 session | ❌ **不可 resume**。開新 run（新 snapshot + 新 digest + 新核可） |

不提供「從 run-state 重算 digest」的路徑：重算的對象是可寫檔案本身，任何被替換的 baseline 都會自洽通過，等於把 worker-resistant 綁定整個拿掉。

**Resume 需要兩樣東西，不是一樣**——只留 digest 不足以 resume：

| 需保存 | 保存在哪 | 為什麼不能省 |
|--------|----------|--------------|
| `baseline_sha256`（hex） | **主 session 脈絡**（壓縮前明確寫進 summary，見 `@rules/context-management.md` Compact Preservation，該清單已列此項） | worker 碰不到的通道；存進 `.claude_workflows/` 就退化成自洽比對 |
| baseline 的**原始位元組** | `snapshot` 的 stdout **原樣落成檔案**（例如 `.claude_workflows/<run-id>/baseline.json`），compare 時以 `--baseline <該檔>` 餵回 | `compare` 是**先對 raw bytes 取 digest、後 parse**（`run-verify.js`：「Digest the raw bytes BEFORE parsing」），所以只差空白／鍵序的兩份 JSON 就是不同 baseline |

**run-state 裡那個巢狀 `baseline` 物件不能拿來 resume**：它是 parse 後再序列化的產物，無法還原 `snapshot` 當初輸出的那串位元組，餵回去必定 digest mismatch（fail-closed，方向正確但等同不可 resume）。因此 v1 的 resume 前提精確地說是「**digest 在脈絡裡 + 原始 baseline 檔案還在**」，兩者缺一即只能開新 run。v2 若要讓 resume 更耐用，選項是定義一個 canonical 序列化並讓 snapshot/compare 兩端都走它——但那會削弱「byte-exact 才算同一份」這個目前最強的綁定，屬取捨而非純改進。

**Plan preview 範例**（兩種任務形狀的對照）：

| 意圖 | 計畫骨架（節錄） |
|------|----------------|
| 「audit 全 repo hook 的 fail-open 路徑」（UC-2，可執行） | s1-s3 `fanout`×3（Explore，shard = hooks 三組，why=「7 個 state-touching hook 依寫入路徑分群」）→ s4 `verify`（完整性 gate，converge max 2）→ s5 報告 `Write` → s6 `gate`（doc-review）。全步可執行 |
| 「完成 feature X 並確保品質」（UC-1，plan-only） | s1 `main-skill` `/tech-spec`（why=「2-tech-spec.md 不存在」）→ s2 `proposed-manual`（實作，mutating=true，**不執行**）→ s3-s4 `gate`（code-review + precommit，G1 強制入計畫）→ s5 `proposed-manual` doc sync。mutating 步驟交人走正常流程 |

### 3.4 Core Logic（執行流程）

```mermaid
sequenceDiagram
    participant U as User
    participant C as Claude（主 session）
    participant S as scripts（context/validate/verify）
    participant P as Planner agent（admission 約束的 read-only 背景）
    participant W as Fanout workers（read-only）
    U->>C: /orchestrate "意圖" --execute
    C->>S: plan-context.js --budget M --out .claude_workflows/<run-id>/plan-context.json
    S-->>C: 摘要（context_path / bytes / sha256 / budget / admission / counts）（或 fail-closed exit 1）
    C->>S: run-verify.js snapshot → baseline（**先於任何 agent 派發**）
    C->>P: 背景派發（**planner = `Explore`**（allowlist 內唯一具研究能力者）；prompt = references/planner-prompt.md + context **封包路徑**；planner 自行讀檔，不內嵌 JSON）
    P-->>C: plan JSON（隨 repo 狀態推導，含 why/gates/收斂）
    C->>S: run-verify.js compare --baseline --baseline-sha256（**planning 後立即驗**；drift 或 digest 不符 → fail-closed，不進 preview）
    C->>S: validate-plan.js --context-sha256 <摘要 sha256>（admission + gate lint + 封包完整性）
    alt lint 失敗
        C->>P: 帶規則代碼重規劃（≤1 次，FR-9）
        P-->>C: 修正後 plan
        C->>S: 重新 lint + compare（仍失敗 → ⚠️ Need Human）
    end
    C->>U: Plan preview（表格 + why + 收斂條件）+ AskUserQuestion
    U-->>C: 核可
    C->>C: Write run-state（.claude_workflows/<run-id>.json；redact 先行，§3.2）
    loop 每個 parallel_group（≤ max_waves）
        C->>W: 平行派發（單訊息多 Agent / Workflow 工具）
        W-->>C: findings（context packet 過濾，沿 deep-explore 模式）
        C->>C: 完整性 gate：done_criteria 未滿足且 round < max_rounds → 下一輪
    end
    C->>S: run-verify.js compare --baseline --baseline-sha256
    alt drift 偵測
        S-->>C: exit 1 + drift 欄位
        C->>U: ⚠️ Need Human（run 標 failed，不寫報告）
    else 無變更
        C->>C: Write 報告（.md → doc hook 設 has_doc_change）
        C->>C: /codex-review-doc（既有 auto-loop 接手）
        alt doc review ✅ Mergeable
            C->>C: run 標 done
            C->>U: Run summary（步驟/理由/證據/報告路徑）
        else ⛔ / degraded / 無法判定
            C->>C: run 標 needs_human（**不得標 done**）
            C->>U: ⚠️ Need Human（doc gate 未過，報告不得視為完成交付）
        end
    end
```

**Baseline 時序不變量**（🔴 教訓固化）：`run-verify.js snapshot` 必須**先於任何 agent 派發**（含 planner）——否則 planner 期間的 mutation 會被併入 baseline，report-only 證明失效。planner 與 fanout worker 受**同一** admission allowlist 約束；planning 結束、preview 之前須先 compare 一次（早期攔截），execute 結束後再 compare 一次（最終攔截）。同一 baseline 全程沿用。

**Planner prompt 契約**（`references/planner-prompt.md`，遵 `rules/codex-invocation.md` 精神）：

| 規則 | 內容 |
|------|------|
| 輸入 | plan-context 封包的**路徑**（候選 + 信號；planner 自行 Read，見 `references/planner-prompt.md`）+ 意圖 + plan schema。**不含**Claude 預擬的步驟（planner 獨立推導，否則 FR-2 的「agent 動態推導」變 rubber stamp） |
| 輸出 | 純 plan JSON（schema §3.3 T2），每步附 `why` |
| 狀態感知要求 | 必須引用 `repo_signals` 解釋取捨（如「`2-tech-spec.md` 已存在 → 跳過 `/tech-spec`」）——Signal 1 的可追溯證據 |
| 邊界 | 不得規劃 allowlist 外的 fanout；mutating 構想一律 `proposed-manual` |

**輸出隔離契約**（鏡射 plan-review 的 namespace 教訓）：`/orchestrate` 自身輸出**禁止**出現 `## Gate:`、bare `✅ Ready` / `✅ Mergeable` / `⛔ Blocked` / `✅ All Pass`；run 總結使用 `## Orchestrate Run Summary` + `[ORCHESTRATE_RUN] run_id=… status=…` 結構行（純行為層標記，無 hook 解析——v1 不新增 hook）。報告寫入後的 doc gate sentinel 由 `/codex-review-doc` 自己輸出（合法路徑）。

**Admission allowlist v1**（`references/admission-allowlist.json`，curated + 每項理由；**收窄原則：驗證面必須 ⊇ 攻擊面，否則不進名單——`Explore` 是這條原則的已知例外**，其通用 `Bash` 的攻擊面含遠端與 repo 外寫入，而驗證面只有本地 repo。它之所以仍在名單內，是因為 `/deep-explore` 早已以同樣暴露在跑，屬 repo 已接受的既有風險而非本功能新增；這是明知的取捨，不是符合原則）：

| Entry | 類型 | 理由 | 殘餘風險（由 T3 pre/post 驗證兜底） |
|-------|------|------|-------------------------------------|
| `Explore` | built-in agent | harness 定義排除 Edit/Write/NotebookEdit；**deep-explore 既有 fanout baseline**（repo 已接受的暴露，非新增攻擊面）；**兼任 planner**（名單內唯一具研究能力者，§3.4） | 有 Bash → 理論可改檔/改 git；由 prompt read-only 契約 + T3 全項 git-scoped 檢查（porcelain+content hashes/refs/config/worktree/stash）正面攔截。**驗證不到**：repo 外檔案寫入、以及經由已驗證 CLI／網路呼叫造成的**遠端**副作用——後者 T3 完全無感，只靠 prompt 契約（v2 OQ：網路停用沙箱或移出可執行 admission） |
| `performance-optimizer` | repo agent | `tools: Read, Grep, Glob` 純讀 | 無 |

**v1 明確排除**（🔴 教訓）：`coverage-analyst`（`Bash(find:*)` 含 `-exec`/`-delete` 寫面）與 `git-investigator`（`Bash(git:*)` 含 tag/config/ref 等寫操作，原 HEAD/branch/stash 檢查蓋不住——T3 已補 refs/config hash，但 deny-by-default 精神下「新增暴露 + 無既有 fanout 先例」不足以換取收益）→ fanout-denied；歷史考古類步驟以 `main-skill`（主 session 跑 `/git-investigate`）或 `proposed-manual` 形式入計畫。其餘 13 repo agents + 全部 skills 一律 fanout-denied（可作 `main-skill` / `proposed-manual` 步驟出現於計畫，但不得作 fanout worker）。**Allowlist 檔案本身受測試鎖定**：每 repo-agent entry 的 frontmatter `tools` 與宣告理由一致，名單變更必過 review + 重審 T3 驗證面涵蓋性。

## 4. Risks and Dependencies

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Planner 幻覺：規劃不存在的 skill / 繞 admission | Medium | Medium | `validate-plan.js` fail-closed lint（A1-S1）+ plan preview human gate；目標（target）必須存在於 plan-context 候選集 |
| R2 | Allowlisted worker（含 planner）經 Bash 改檔/改 git metadata（change flag 抓不到） | Low | High | **雙層**：admission 收窄至 Explore + performance-optimizer（驗證面 ⊇ 攻擊面原則）+ T3 pre/post 驗證正面攔截（HEAD/branch/porcelain-uall/**tracked+untracked content hash**/**refs/local-config**/worktree/stash）；snapshot **先於任何 agent 派發**；planning 後 + execute 後各 compare 一次；drift → fail-closed 不寫報告 |
| R3 | run-state 與 safety state 混淆（兩平面分歧） | Low | High | schema 級分離（run-state 無 safety 欄位）+ orchestrator 只讀 safety plane + 測試斷言 run 過程 `.claude_review_state.json` 不被 skill 寫入 |
| R4 | DW preview API 變動 / 不可用 | Medium | Low | backend 可插拔；預設 fallback background `Agent` ≤3（feasibility Backup B = C 去 DW，執行後端互換） |
| R5 | compaction 中斷 run（post-compact hook 不知 workflow 狀態） | Medium | Medium | run-state 寫入磁碟 + `--resume`；read-only 步驟冪等可重跑；hook 級 resume 整合列 v2 OQ |
| R6 | 計畫品質不如人腦編排（採用阻力） | Medium | Low | preview = 預設交付物（人可改可棄）；`why` 必填提供可審視性；pilot 量測後迭代 planner prompt |
| R7 | sentinel 污染（orchestrate 輸出誤觸 hook 解析） | Low | High | 輸出隔離契約 + S1 lint + skill 結構測試 grep 禁字 |
| R8 | run-state 檔累積 / 洩漏敏感意圖 | Low | Medium | FIFO 10 檔清理；gitignore；意圖文字過 `security-redact.js` **完整 contract**（high-confidence → abort 不寫檔 + `needs_human`；medium → mask）——禁 medium-mask-only 弱化版 |

**Dependencies**：

| Dependency | Type | Status |
|------------|------|--------|
| `docs/skill-catalog.yml` 持續維護 | Internal | 已有（`/update-readme` 流程共用） |
| `Workflow` 工具（DW preview） | External（可選） | 可用則用；R4 fallback 已設計 |
| `security-redact.js` | Internal | 已 ship（plan-review 共用） |
| Spike 1/1b 結論（mutation 解禁前置） | Internal | 已完成（feasibility §8）——**v1 不依賴**，v2 mutation 平面才依賴 |

## 5. Work Breakdown

| ID | Task | Depends | Size | Test mapping |
|----|------|---------|------|--------------|
| **W1** | **plan-context.js** | — | M | `test/scripts/orchestrate-plan-context.test.js` |
| W1.1 | catalog/agents 解析 + 候選組裝 + repo 信號 | — | M | fixture catalog 新增 dummy entry → 候選自動含（**SC-5 自動化證據**）；YAML 壞檔 → exit 1 |
| W1.2 | budget tier + fail-closed 超量檢查 | W1.1 | S | 超 `max_context_bytes` → exit 1 + 來源列表；S/M/L 邊界 |
| W1.3 | admission allowlist 載入 + `fanout_eligible` 標記 | W1.1 | S | 非名單 agent → `deny_reason`；**名單檔缺失/解析失敗 → exit 1**（與 T1 fail-closed contract 一致）；`use_when` 缺漏 → description fallback |
| **W2** | **validate-plan.js** | W1 | M | `test/scripts/orchestrate-validate-plan.test.js` |
| W2.1 | lint 規則 A1-A4 / G1-G2 / O1 / B1 / S1 / SCHEMA | W1.3 | M | 每規則一組（合法過 / 違規 exit 1 + 代碼）；G1：code-mutation proposed-manual 計畫缺 code-review+precommit → 拒（**Signal 2 自動化證據**） |
| **W3** | **run-verify.js** | — | M | `test/scripts/orchestrate-run-verify.test.js` |
| W3.1 | snapshot / compare（HEAD/branch/porcelain-uall hash/**tracked+untracked content hash**/**refs hash/local-config hash**/worktree/stash） | — | M | fixture repo：commit / 切 branch / 新增 untracked / **再改已 dirty tracked 或 untracked 檔內容** / **打 tag / 改 local config** / stash / 開 worktree 各 → compare exit 1 列 drift 欄位；無變更（含 **dirty baseline 無新 drift**、**gitignored run-state 合法寫入**）→ exit 0（**SC-2 自動化證據**） |
| **W4** | **Skill + references + run-state** | W1-W3 | L | `test/skills/orchestrate.test.js` |
| W4.1 | `SKILL.md`（流程 / flags / baseline 時序不變量 / 輸出隔離契約 / FIFO 清理 / redact run-state / doc-gate→`done` 狀態規則） | W1-W3 | L | 結構斷言：references 存在、禁 sentinel 字串、allowed-tools 合理、含「snapshot 先於 agent 派發」與「done 唯一路徑 = doc review ✅」字句 |
| W4.2 | `references/planner-prompt.md`（獨立推導契約）+ `plan-schema.md` + `execution-policy.md` | W4.1 | M | 引用存在 + prompt 含「不含 Claude 預擬步驟」+ schema 與 validate-plan 規則一致性 spot-check |
| W4.3 | `admission-allowlist.json`（2 entries + 理由 + 排除名單記錄） | W4.1 | S | 每 repo-agent entry 的 frontmatter `tools` 與理由一致（**allowlist-frontmatter 鎖定測試**）；斷言 `coverage-analyst`/`git-investigator` 不在名單 |
| W4.4 | `.gitignore` 加 `.claude_workflows/`（**hard precondition：先於 W4.1 任何 run-state 寫入路徑合入**） | — | S | `git check-ignore .claude_workflows/foo.json` 斷言 |
| W4.5 | `scripts/prune-runs.js`：FIFO 保留的可執行實作 + SKILL.md 改為指名該指令 | W4.1 | S | `test/scripts/orchestrate-prune-runs.test.js`：`.json` 與同名目錄成對刪除、僅存其一仍計數、排序依 run-id 而非 mtime、`--dry-run` 不刪、非 `.claude_workflows` root／symlink root 拒絕、認不得檔名保留 |
| **W5** | **登錄 + 文件 + ticket** | W4 | S | |
| W5.1 | `docs/skill-catalog.yml`（planning category）+ CLAUDE quick-ref ×3 | W4 | S | skills-schema / claude-md-coverage 既有測試 |
| W5.2 | request ticket（`/create-request`） | W4 | S | — |

預估：~3-5 人日（feasibility v1 估值內）。**Orchestrate 變更全程零 hook diff**——範圍證明：`grep -ri orchestrate hooks/` 為空、`git diff HEAD -- hooks/` 不含 orchestrate 相關修改（同 worktree 內其他 feature 的 hooks 變更不在此聲明範圍）。

## 6. Testing Strategy

| Layer | Scope | Cases (key) |
|-------|-------|-------------|
| **Unit** | `plan-context.js` | dummy catalog entry 自動入候選（SC-5）；budget 超量 fail-closed；**allowlist 缺失 → exit 1**；YAML/frontmatter 壞檔 exit 1；`use_when` 缺漏 → SKILL.md description fallback；repo 信號含 features 列表（Signal 1 素材） |
| **Unit** | `validate-plan.js` | A1 非名單 fanout 拒；A3 mutating 非 proposed-manual 拒；G1/G2 gate 完備性（Signal 2）；O1 缺 why 拒（Signal 6）；B1 budget 上限；S1 sentinel 禁字 |
| **Unit** | `run-verify.js` | commit / branch / untracked（-uall 級）/ **tag（refs hash）/ local config** / stash / worktree 各類 drift → exit 1；乾淨與 **dirty-baseline 無新 drift** → exit 0（SC-2） |
| **Unit** | allowlist-frontmatter 鎖定 | 每 repo-agent entry 與 `agents/*.md` frontmatter 一致；名單外 agent 在 plan-context 輸出帶 `deny_reason`；`coverage-analyst`/`git-investigator` 斷言不在名單 |
| **Unit** | skill 結構 | SKILL.md 禁 hook sentinel；references 存在；schema 文件與 lint 規則代碼一致；含 baseline 時序不變量與 doc-gate→done 規則字句 |
| **Unit** | 兩平面隔離 | `.gitignore` 含 `.claude_workflows/`；run-state sample 經 jq 驗無 safety 欄位（schema 級分離） |
| **Integration**（v1 deferred → pilot 手動） | UC-2 端到端（audit 主題 → 計畫 → 核可 → fanout → verify → 報告 → doc review） | Signal 3。Skill 為 model-driven markdown，無法以 node:test 驅動 planner/fanout；v1 以上列 scripted 證據 + pilot 手動驗證取代（同 plan-review v1 模式） |
| **Regression** | 既有 hook 測試全套 | v1 零 hook diff → 既有 `test/hooks/**` 全綠即 Signal 4（無新增 fixture 需求） |

Conventions 遵 [`rules/testing.md`](../../../rules/testing.md)：AAA、`assert/strict`、≤7 assertions/case、realistic data。Evidence 對應（Acceptance Signals 定義於 [1-requirements.md §8](./1-requirements.md)）：Signal 1/2/5/6 的 scripted 面向 + Signal 4 由自動化覆蓋（priority 1）；Signal 1 的 planner 級「計畫隨現況變動」與 Signal 3 端到端屬 model 行為，v1 以 pilot 手動驗證（priority 2/3）。

## 7. Open Questions

### 7.1 已於本 spec 拍板

| OQ（from requirements §9） | 決策 |
|---------------------------|------|
| DW vs 自製 | 兩者皆非單選：DW 為可選 fanout backend，admission/verify 不依賴它（feasibility Option C + Backup B） |
| 意圖 schema | v1 = 自然語言意圖 + 結構化 flags（budget/execute）；planner 負責結構化為 plan JSON（宣告式收斂點在 plan schema，非輸入端） |
| skill 前置/後置 metadata | v1 不為全 catalog 補 metadata；以 catalog `use_when` + repo 信號 + planner 推導替代；完整 `mutation:` schema 列 v2（Spike 3） |
| 與 hook FSM 衝突 | 兩平面分離 + orchestrator 只讀 + 報告走既有 doc loop——無第二套 enforcement，無衝突面 |
| v1 任務形狀邊界 | 端到端：audit/research（UC-2）；plan-only：feature/bugfix（UC-1 產計畫，mutating 步驟 proposed-manual 交人） |

### 7.2 Deferred to V2

| OQ | 條件 |
|----|------|
| Mutation 編排（DW subagent 或主 session 自動執行 mutating 步驟） | feasibility §7 護欄 (1)-(7) 全綠 + Spike 2（16 並行 lock）+ Spike 3（mutation metadata） |
| `safety_epoch` + CAS | mutation 平面設計時一併 |
| compaction 後 run 自動 resume（hook 整合） | 需 `post-compact-auto-loop.sh` 認得 run-state——破壞「零 hook diff」，故 v2 |
| FR-10 計畫保存/重用 + 版本化 | pilot 證明計畫品質後再投資 |
| 漸進式採用路徑（逐步確認模式） | pilot 回饋決定（requirements §9 最後一問） |

## 8. References

- Canonical: [`./1-requirements.md`](./1-requirements.md)、[`./0-feasibility-study.md`](./0-feasibility-study.md)
- Sibling lifecycle: [`docs/features/plan-review-loop/2-tech-spec.md`](../plan-review-loop/2-tech-spec.md)（namespace 隔離 + v1 deferred-to-pilot 測試模式先例）、[`docs/features/multi-agent-enhancement/2-tech-spec.md`](../multi-agent-enhancement/2-tech-spec.md)（Phase C 排除聲明）
- Reused patterns: [`skills/deep-explore/SKILL.md`](../../../skills/deep-explore/SKILL.md)（wave fanout + context packet）、[`skills/next-step/scripts/analyze.js`](../../../skills/next-step/scripts/analyze.js)（repo 信號）、[`scripts/security-redact.js`](../../../scripts/security-redact.js)
- Safety plane（只讀對象）: [`hooks/post-edit-format.sh`](../../../hooks/post-edit-format.sh)、[`hooks/stop-guard.sh`](../../../hooks/stop-guard.sh)
- Rules: [`rules/auto-loop.md`](../../../rules/auto-loop.md)、[`rules/git-workflow.md`](../../../rules/git-workflow.md)、[`rules/codex-invocation.md`](../../../rules/codex-invocation.md)、[`rules/testing.md`](../../../rules/testing.md)、[`rules/security.md`](../../../rules/security.md)
