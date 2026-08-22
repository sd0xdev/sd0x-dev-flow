# Requirements: Harness Engineering Rebrand

> **Phase**: 1 (Requirements analysis) · **Status**: Superseded by implementation · **Advisory**
> **Tech Spec**: _(skipped by user decision — see request ticket)_
> **Request tickets**: [2026-04-12-harness-engineering-rebrand.md](./requests/2026-04-12-harness-engineering-rebrand.md) (Completed)
>
> **⚠️ Supersession note** (2026-04-12): The following counts in this document were reconciled during implementation and should be read against the authoritative values in the request ticket + shipped README:
>
> | Location | Original text | Value shipped **at 2026-04-12** |
> |----------|--------------|---------------------|
> | §4.2 FR-S1 "target: all surfaces say 92 skills" | 92 (filesystem count) | **90** (catalog-public count from `docs/skill-catalog.yml`; 2 local-only skills `readme-i18n-sync` + `update-readme` are gitignored) |
> | §8.1.3 unified JSON description sample | "92 skills" | **90 skills** (byte-exact in `.claude-plugin/plugin.json`, `package.json`, `.claude-plugin/marketplace.json`) |
> | §5 Pattern Map row 5 "83 of 92 skills with allowed-tools" | 83 of 92 (filesystem) | **81 of 90** (public, after subtracting 2 local-only skills which both declare `allowed-tools`) |
>
> The reconciliation rationale: `scripts/generate-readme-catalog.js` reads public skill count from catalog, not filesystem, so the marketing surfaces must use catalog count to avoid drift with auto-generated README blocks.
>
> **關於「Original text」欄（2026-08-20 round 16 記入，2026-08-21 更正並降級為附註）**：此欄名雖寫
> 「Original text」，**內容其實是摘述而非逐字原文**——三格都是。round 16 曾據此把欄名就地改寫為
> 「原始草稿值（摘述，pre-commit，git 無來源）」，並把第三欄改為「Value shipped **at 2026-04-12**」；
> 兩者都是**對記錄本文的就地改寫**，正是本檔自陳禁止的行為。**本文不還原**（2026-08-21 定案）：把已
> 提交的就地改寫再改回去是第二次改寫，不是修復。`88a4f50` 的四月原形以
> `git show 88a4f50:docs/features/harness-engineering-rebrand/1-requirements.md` 取回。
>
> round 16 同時寫下「第三列的 `83 of 92` **在本檔任何 commit 中都不存在**」——**這句是錯的**，2026-08-21
> 重新推導：
>
> ```bash
> for c in $(git log --format=%h -- docs/features/harness-engineering-rebrand/1-requirements.md); do
>   printf '%s: ' "$c"; git show "$c:docs/features/harness-engineering-rebrand/1-requirements.md" | grep -c '83 of 92'
> done
> #=> f06c0ed: 2 / 96786d1: 2 / 88a4f50: 1
> ```
>
> 正確的收窄陳述是：`83 of 92` **從未以 § 5 Pattern Map 主表列的形式**出現在任何已提交版本——它只
> 出現在本 supersession 表的第三列（三個 commit 皆有），以及 `96786d1` 起加入的快照表列。最早的已
> 提交 blob 的 § 5 第 5 列就已經寫 `81 of 90`。因此本欄的三個值仍屬 commit 前草稿、git 中無可稽核
> 來源，但「任何 commit 中都不存在」這個更強的說法不成立。
>
> **⚠️ Supersession note** (2026-08-20): the rule stated below under **📌 Every number in this document is a dated snapshot** — *do not correct in place* — applies to this document's **claims**, not only its numbers. **本表記錄的是另外兩項被推翻的主張**——它不是「2026-04-12 後所有變動」的完整清單：§ 5 第 7 列本身就是第三項（`96786d1` 把 dual-by-default 改為 Codex-only-by-default），而 `0b3b8f5`（2026-08-13）又移除了 Pattern Map 數列所引用的機制。七月那批就地改寫另由下方 § 5 的日期附註記錄。以下兩項記錄於本 addendum，而非改寫下方被保存的需求正文：
>
> | Location | What it says (correct on 2026-04-12) | What changed |
> |----------|--------------------------------------|--------------|
> | § 2.1 C2 "GitHub repository slug MUST NOT change" (`sd0xdev/sd0x-dev-flow`), and § 3 stakeholder row "Agent Skills ecosystem — not touching repo slug means no impact" | The slug was held fixed because marketplace redirect behaviour was unverified | The repo **was** renamed to `sd0xdev/sd0x-harness` on 2026-08-16. Canonical **as of 2026-08-20**（then-HEAD `2692ede`）: `.claude-plugin/marketplace.json:9`、`README.md:25` —— 兩者皆已提交，`git show 2692ede:…` 可複驗。**`skills/codex-setup/SKILL.md:12` 不在此列**（2026-08-21 更正）：`git show 2692ede:skills/codex-setup/SKILL.md \| sed -n '12p'` 仍是 `npx skills add sd0xdev/sd0x-dev-flow`，新 slug 只存在於**未提交的工作樹**。前一版把三個檔案並列為同一種出處，把「已提交」與「僅在工作樹」混為一談。 C2's *rationale* was never falsified — it was a risk the later change accepted and paid for |
> | § 5 rows 6 and 9 (defense-in-depth layers; `/dev/tty` as the human gate) | `/codex-setup` installed both git hooks unconditionally, so all 5 layers shipped | **決議 2026-08-15；實作在 2026-08-20 工作樹，未提交至 then-HEAD `2692ede`**——該 commit 的 `/codex-setup` 仍無條件安裝兩個 hook。改為 opt-in 後，**失去 pre-push 這一層的只有兩格**：首次安裝且無 gate 可承接、以及記錄為 `declined` 的專案。**既有 gate 是被 grandfather 的**——state 記為 `installed`、或 `unknown` 但磁碟驗出 sd0x wiring 的專案，都會被保留並重新複製，不需帶 `--with-push-gate`（依工作樹 `skills/codex-setup/SKILL.md` 的 lifecycle 矩陣）（其餘四層是否在跑，取決於該專案是否載入對應的 Claude event hooks——`/codex-setup` 只裝 git hook 與 runner scripts，不裝那些，所以「5 層中的 4 層」不是可普遍斷言的每專案計數）。**另一點與 opt-in 無關**：`/dev/tty`-terminal ÷ `AskUserQuestion`-advisory 的分工，**從一開始就**只適用於 hook 實際會提示的那一類推送（**未先被 non-fast-forward 閘門擋下**、ref set 含 protected branch、且 `ALLOW_PUSH_PROTECTED` 未設——三個條件缺一不可。`ALLOW_FORCE_WITH_LEASE` 未設時，non-fast-forward 推送在 protected 判定之**前**就 `exit 1`，即使目標是 protected branch 也到不了 `/dev/tty`）；**其餘被 hook 放行（`exit 0`）且未提示的推送**，`AskUserQuestion` 才**是**授權本身。**被拒絕的推送是第三種結果，不屬於上述任一類**：`ALLOW_FORCE_WITH_LEASE` 未設的 non-fast-forward 推送在憑證選擇之前就 `exit 1`（即使 `ALLOW_PUSH_PROTECTED=1` 也一樣，該旗標不會讓它跳過這道更早的拒絕）；protected 推送若開不了 `/dev/tty` 亦是拒絕。兩者都沒有推送發生，`AskUserQuestion` 授權了「什麼都沒有」。把它寫成無條件保證，是撰寫當時就過寬，不是 opt-in 造成的收窄。現行契約：`rules/discretion.md` § Efficacy Boundary、`@rules/git-workflow.md` § Push safety |
>
> **更正（2026-08-21 round 26）**：上一列括號內寫「`ALLOW_FORCE_WITH_LEASE` 未設時，non-fast-forward 推送在 protected 判定之**前**就 `exit 1`」——**只對 force 形式成立**，寫成無條件即過寬。依本檔體例不改寫上文，於此追加：非快轉推送有兩種拒絕來源，取決於推送**形式**。帶 `--force-with-lease` 時 git 把 ref 交給 hook，由 **hook** 自己 `exit 1`；**不帶旗標**時是 **git 自己**在 hook 執行之前就拒絕——git 會扣住它已經拒絕的 ref，hook 因此收到**空的 ref 清單**，找不到分支、驗不出分歧，`exit 0` 而什麼也沒擋。結論不變（兩種都沒有推送發生，`AskUserQuestion` 授權了「什麼都沒有」），改變的是**哪一個機制拒絕**：把不帶旗標那一種記在 gate 頭上，等於把一次它從未看見的拒絕算成它的功勞，而讀者會據此期待一個未安裝的 hook 去擋分歧。逐形式對照見 [`../push-gate-optin/2-tech-spec.md`](../push-gate-optin/2-tech-spec.md) § 2.3 與 `test/scripts/pre-push-gate.test.js` 的 `REFLINES:0` / `REFLINES:1` 兩例。
>
> The durable content of rows 6 and 9 is the layer **inventory** and the **gate design**; how much depth a given project gets moves with what it installed.
>
> ---
>
> **⚠️ 本檔曾違反自己的規則：`96786d1`（2026-07-26）就地改寫了 § 5 的六列**——而**同一個 commit** 才剛加上下方那條「不得就地更正」的規則。
>
> **定案處置（2026-08-21）：一律不還原**——把已提交的就地改寫再改回去是第二次改寫，不是修復。本文
> 即 `96786d1` 的七月字句；四月原文自 git 取回。逐列如下：
>
> | § 5 列 | `96786d1` 的改動性質 | 現況 |
> | ------ | -------------------- | ---- |
> | 2、5、7、8 | **設計主張就地改寫**（四列） | § 5 表**不還原**，本文即七月字句；2026-04-12 原文以 `git show 96786d1^:docs/features/harness-engineering-rebrand/1-requirements.md` 取回 |
> | 3、6 | **引用維護**——宣稱未變，只把易變行號換成穩定描述 | 保留七月形式，不還原（那是改善，不是推翻） |

> **清單不只 § 5 六列（2026-08-21 補）**：`96786d1` 另有**兩處**就地改寫落在本 supersession 區塊本身，
> round 15／16 的盤點都漏了：
>
> | 位置 | `88a4f50`（四月原文） | `96786d1` 改成 | 現況 |
> | ---- | --------------------- | -------------- | ---- |
> | supersession 表頭第三欄 | `Actual value shipped` | `Value shipped **at 2026-04-12**` | **不還原**；四月原文以上列 `git show 88a4f50:…` 取回 |
> | reconciliation rationale 句 | `must use catalog count (90) to avoid drift` | 刪去 `(90)` | **不還原**；同上 |
>
> 抽出指令：`git show 88a4f50:docs/features/harness-engineering-rebrand/1-requirements.md | sed -n '9p;15p'`
> 對比 `git show 96786d1:… | sed -n '9p;15p'`。
>
> **本段所稱「前一版」一律指 2026-08-20 同日、未提交的工作樹草稿，git 中無 blob 可稽核**；可稽核的只有它被改成什麼，也就是下方這張表所陳述的現況。前一版此處另有一張標著「2026-04-12 原文」的表，內容其實是我壓縮改寫的摘要、且第 5 列混入原文沒有的詮釋。該表已刪除；此處不再引任何原文，兩份原文各有一個機械抽出的落腳處：
>
> | 哪一份原文 | 落在哪裡 | 抽出指令 |
> | ---------- | -------- | -------- |
> | **2026-04-12 四月原文**（`96786d1` 的**父** commit） | **本檔不留副本**——只能自 git 取回 | `git show 96786d1^:docs/features/harness-engineering-rebrand/1-requirements.md` |
> | **2026-07-26 七月改寫**（`96786d1` 本身） | **§ 5 主表本文**（未還原），下方日期附註另存一份 | `git show 96786d1:docs/features/harness-engineering-rebrand/1-requirements.md` |
>
> （兩者容易寫反：**主表**與**附註**都是**子** commit `96786d1` 的七月文字——附註是主表那四列的一份對照
> 副本；**父** commit `96786d1^` 的四月文字在本檔中沒有副本，只能自 git 取回。）
>
> 真正的教訓是規則本身——一條「不得就地更正」的規則，若由一個正在就地更正的 commit 寫下，它從第一天起就沒有被遵守過。
>
> **📌 Every number in this document is a dated snapshot, not a live value.** The catalog grows; these figures were correct on 2026-04-12 and are preserved as the historical record of that decision. Do not "correct" them in place — that would falsify what was reconciled at the time. Re-derive the current values instead:
>
> ```bash
> node -e "const fs=require('fs');
> const b=fs.readFileSync('docs/skill-catalog.yml','utf8').split(/^skills:/m)[1];
> const c=[...b.matchAll(/^\s+-\s+command:\s*\/(\S+)/gm)].map(m=>m[1]);
> const d=fs.readdirSync('skills').filter(x=>fs.existsSync('skills/'+x+'/SKILL.md'));
> const at=n=>/^allowed-tools:/m.test(fs.readFileSync('skills/'+n+'/SKILL.md','utf8'));
> console.log('catalog(public):',c.length,'| filesystem:',d.length);
> console.log('allowed-tools:',c.filter(at).length,'of',c.length,'(public) ·',d.filter(at).length,'of',d.length,'(filesystem)');"
> ```
>
> | Snapshot | Catalog (public) | Filesystem | `allowed-tools` (public) | `allowed-tools` (filesystem) |
> |----------|-----------------|-----------|--------------------------|------------------------------|
> | 2026-04-12 (rebrand) | 90 | 92 | 81 of 90 | 83 of 92 |
> | 2026-07-25 (measured) | 98 | 100 | 89 of 98 | 91 of 100 |
>
> The invariant that survives both snapshots: filesystem = catalog + 2 (the gitignored local-only pair), and exactly **9** skills inherit default permissions rather than declaring `allowed-tools`.
>
> **篇幅處置（2026-08-21 round 25 提出、round 26 重測定案）**：`wc -l` 為 **434** 行，落在
> `@rules/docs-numbering.md` § Size Limit 的 401–500 帶——該帶要求「下次實質編輯時把死掉的段落 prune 掉」。
> 這次編輯就是那個時機，評估結果是 **prune 無可施力，維持全檔**。理由是本檔的性質：Status 已是
> **Superseded by implementation**，也就是整份都是記錄；`node scripts/classify-docs-cli.js --feature
> harness-engineering-rebrand` 回報 `role: "Design record"`、`current_authority: []`。§ Size Limit 對
> prune 的定義是「移除**死掉的**文字，不是移除不方便的文字」，而在一份記錄裡「與今日脫節」正是它在運作，
> 不是死文字——刪掉就是唯一一份原文消失。結構上：`## ` 標題 11 個（全部在 code fence 之外，故 raw
> `grep -c` 與實際章節數一致）、正文 §1–§10 自 `:119` 起共 316 行、開頭的 supersession／更正註記
> 118 行，沒有任何一段是重複的，故 merge 也無對象。**編輯結束後才量測**——round 25 這則處置最初寫的
> 417 行是在同輪編輯中途量的，隨後追加的更正註記立即使它過期。**下次實質編輯時重新量測**；
> 若超過 500 行，自然切點是 § 8 Tagline Decision Inputs（它自陳是給 tech spec 的上游參考，可獨立成子檔）。
>
> **對 doc review 的備註**：本檔曾被審查者判為「`1-requirements.md` 是 lifecycle 文件，故應就地改寫為
> 今日行為」。分類器不支持該前提（見上），且本檔自陳的 Supersession note 體例正是記錄的正確更新方式。

## 1. Problem Statement

### 1.1 Surface Requirement

Update the brand layer of `sd0x-dev-flow` to position it as a reference implementation of **AI Agent Harness Engineering**, an emerging discipline coined by Mitchell Hashimoto in Feb 2026 and adopted by Martin Fowler, Anthropic engineering blog, and arXiv literature. Rebrand must touch README, repository metadata, and locale documentation — **without disrupting existing plugin installations or the upgrade path**.

### 1.2 5-Why Root Analysis

| Depth | Question | Answer |
|-------|----------|--------|
| Why 1 | Why rebrand? | Current tagline ("Development workflow plugin with 100+ tools") describes tooling, not discipline; does not communicate what the project actually is. |
| Why 2 | Why does the discipline framing matter? | "Harness engineering" is now an industry-recognized term; sd0x-dev-flow already implements 10 of its canonical sub-problems (see §5 Pattern Map). Failing to claim the category cedes discoverability to weaker implementations. |
| Why 3 | Why not just update the tagline? | Brand is scattered across 11+ surfaces (plugin.json, package.json, marketplace.json, 6 locale READMEs, CLAUDE.md, GitHub About). Uncoordinated edits produce drift. |
| Why 4 | Why must existing installs be protected? | `plugin.json` `name` field is the stable identifier for install/upgrade resolution; derived paths (`.claude/sd0x-dev-flow-lessons.md`, `~/.config/sd0x-dev-flow/`) are hardcoded as literals in scripts. Any change orphans user state. |
| Why 5 (root) | Why does this matter beyond cosmetics? | The rebrand is also a content opportunity: the README can become a learning artifact — a line-by-line demonstration of what harness engineering looks like in production code — not just a tool catalog. This unlocks a new audience (harness-engineering learners) in addition to existing users. |

### 1.3 Root Problem

> **sd0x-dev-flow already implements harness engineering at scale (2,021 lines of hook code, 92 skills, 14 rules, 10 covered sub-problems), but its brand layer describes it as a "development workflow plugin with 100+ tools" — which is both inaccurate to its nature and invisible to its strongest audience (harness engineering practitioners and learners).** The rebrand must reposition without breaking existing plugin identity, and should upgrade the README into a reference implementation guide rather than a tool catalog.

## 2. Constraints & Assumptions

### 2.1 Hard Constraints (Non-Negotiable)

| # | Constraint | Rationale | Evidence |
|---|------------|-----------|----------|
| C1 | **`plugin.json` `name` field MUST NOT change** | Stable identifier for install/upgrade; derived paths in scripts hardcode the literal | `.claude-plugin/plugin.json:2` |
| C2 | **GitHub repository slug MUST NOT change** | Marketplace redirect behavior is unverified; breaking it requires manual migration for every existing user | `.claude-plugin/marketplace.json:9` (`"repo": "sd0xdev/sd0x-dev-flow"`) |
| C3 | **`package.json` `name` field MUST NOT change** | npm identity; sync-locked with plugin.json | `package.json:2` |
| C4 | **File names `README.md`, `CLAUDE.md`, `.claude/sd0x-dev-flow-lessons.md` MUST NOT change** | Claude Code discovery + derived state paths | Convention + `rules/self-improvement.md` § Lesson format (canonical log path) |
| C5 | **`~/.config/sd0x-dev-flow/` git-profile registry path MUST NOT change** | User-specific config directory; renaming orphans git-profile configurations | `skills/git-profile/scripts/git-profile.sh:18,33` |
| C6 | **Hook regex patterns matching `sd0x-dev-flow:` prefix MUST NOT change** | Namespace-qualified command references | `hooks/stop-guard.sh` — the `HAS_CODEX_REVIEW` / `HAS_PRECOMMIT` / `HAS_REVIEW_DOC` transcript-fallback greps; `hooks/post-tool-review-state.sh` — the `_code_review_matched` / `_doc_review_matched` / `_precommit_matched` command greps and `_precommit_mode_of()`. Cited by symbol, not line range: these files shift on every hardening pass |

### 2.2 Soft Constraints

| # | Constraint | Rationale |
|---|------------|-----------|
| S1 | All 6 locale READMEs must stay synchronized (diff-based translation via `/readme-i18n-sync`) | Prevent locale drift |
| S2 | Existing brand equity "Quality gates that AI can't skip" should be preserved | Brand recall + literal truthfulness in strict/dual mode |
| S3 | Metadata consistency: 90+ vs 100+ vs actual 92 skill count must be unified | Inconsistent numbers undermine rebrand credibility (discovered by Codex during tagline brainstorm) |
| S4 | New tagline must translate naturally into zh-TW, zh-CN, ja, ko, es | Avoid metaphors that only work in English |

### 2.3 Assumptions Register

| Assumption | Class | Source |
|------------|-------|--------|
| GitHub's `repo/description/topics` edits do not trigger plugin reinstall | Compatibility | Shard D research (unverified in Claude Code marketplace code) |
| Changing JSON `description` fields does not invalidate install-state manifest | Compatibility | `.sd0x/install-state.json` schema only tracks version + file hashes, not descriptions |
| The term "harness engineering" will remain a stable industry term for at least 12 months | Business | Based on adoption by Anthropic / Fowler / arXiv in Feb-Apr 2026 |
| `/readme-i18n-sync --full` can retranslate all 5 locale READMEs in one pass | Technical | `skills/readme-i18n-sync/SKILL.md:44-59` |
| Existing users re-running `/plugin update` will pull new description on next sync | Technical | Standard Claude Code plugin update flow — needs manual verification |

### 2.4 Out of Scope

| Item | Reason |
|------|--------|
| Renaming the plugin internally (`plugin.json` `name`) | C1 — breaking change for existing users |
| Renaming the GitHub repo slug | C2 — marketplace redirect unverified |
| Migrating lesson log file name | C4 — would orphan existing user lesson history |
| Changing the default `GUARD_MODE` to strict | Separate tech decision; discussed in open questions |
| Code-level changes beyond description-layer text | Feature dev scope, not rebrand scope |

## 3. Stakeholders

| Role | Key Concern | Impact |
|------|-------------|--------|
| **Existing plugin users** | `/plugin update` must not break; derived state (lesson log, git-profiles, review state) must remain valid | High — zero disruption is the core success criterion |
| **New plugin users (harness learners)** | Finding the project via "harness engineering" search terms; understanding the discipline from the README | Medium — new audience acquisition |
| **New plugin users (Claude Code newcomers)** | 3-second comprehension: "what does this do for me?" | Medium — must not sacrifice onboarding clarity for discipline positioning |
| **Plugin maintainers (you)** | Consistent metadata across 11+ surfaces; simple propagation workflow via `/readme-i18n-sync` | High — drift is the main maintenance cost |
| **Locale README consumers (zh-TW/zh-CN/ja/ko/es)** | Natural-sounding translations; technical terms handled per locale convention | Medium — see `rules/docs-writing.md` locale policy |
| **Agent Skills ecosystem** | `npx skills add sd0xdev/sd0x-dev-flow` command path continues to work | Low — not touching repo slug means no impact |
| **sd0x-dev-flow contributors (future)** | Understanding why certain strings are locked (for grep-safety during future refactors) | Low — captured in this doc |

## 3.1 Use Cases

Concise traceability from stakeholder → use case → primary requirement:

| UC | Stakeholder | Trigger | Expected Outcome | Primary FR |
|----|-------------|---------|------------------|-----------|
| UC-1 | Existing plugin user | Runs `/plugin update` after rebrand ships | Pulls new description text; no state loss; no reinstall prompt | FR-M1..M3, C1..C6 |
| UC-2 | Harness-engineering learner | Searches GitHub / Google for "harness engineering claude code" | Finds sd0x-dev-flow in results; README explains discipline with code evidence | FR-M8, FR-M9, FR-S2 |
| UC-3 | Claude Code newcomer | Visits GitHub repo About panel first | Reads ≤350-char About text and understands in <10 seconds | FR-M7, §8.0 TA-7 |
| UC-4 | Locale reader (zh-TW/zh-CN/ja/ko/es) | Opens `README.<locale>.md` | Sees localized version carrying the same positioning and Pattern Map | FR-M5, §8.0 TA-5 |
| UC-5 | Maintainer (you) | Later runs `/bump-version` or `/claude-health` | Tool reports no metadata drift across the three JSON description fields | FR-S1, FR-S4 |
| UC-6 | Future contributor | Greps for `sd0x-dev-flow` during refactor | This requirements doc explains which literals are locked and why | §2.1 Hard Constraints |

## 4. Functional Requirements (MoSCoW)

### 4.1 Must Have

| ID | Requirement | Rationale |
|----|------------|-----------|
| FR-M1 | Update `.claude-plugin/plugin.json` `description` field to new harness-engineering-forward text | Primary surface for marketplace listing |
| FR-M2 | Update `package.json` `description` field to match plugin.json (unified metadata) | Resolves 90+/100+ inconsistency (S3) |
| FR-M3 | Update `.claude-plugin/marketplace.json` `description` field to match | Third surface — same text unified |
| FR-M4 | Update `README.md` H1 title text (not filename), hero tagline, and "Why sd0x-dev-flow?" heading if needed | Canonical brand surface |
| FR-M5 | Propagate README changes to all 5 locale files via `/readme-i18n-sync --full` | Consistency across languages |
| FR-M6 | Update `CLAUDE.md` Line 1 project title to match new positioning | Project-level instruction doc |
| FR-M7 | Update GitHub repository "About" section via GitHub UI (user operation, not file edit) | Primary GitHub discovery surface |
| FR-M8 | Update GitHub repository Topics to include `harness-engineering`, `agent-harness`, `claude-code-plugin` | SEO discoverability |
| FR-M9 | Add a new README section titled **"What This Harness Does"** using the Pattern Map (see §5) as its skeleton | The core content opportunity — converts README from tool catalog to reference implementation guide |
| FR-M10 | Preserve "Quality gates that AI can't skip" as secondary slogan directly beneath the new primary tagline | Brand continuity + literal truthfulness in strict/dual mode |

### 4.2 Should Have

| ID | Requirement | Rationale |
|----|------------|-----------|
| FR-S1 | Unify the count inconsistency across plugin/package/marketplace descriptions to match the actual skill count. Current state: `plugin.json:3` says "100+", `marketplace.json:11` says "90+", `README.md:12` says "90 skills", actual `ls skills/ \| wc -l` returns **92**. Target: all surfaces say `92 skills` | Credibility (S3) — separate concern from rebrand but must ship together |
| FR-S2 | Add an "Academic references" or "Harness engineering primer" sub-section in README linking to Martin Fowler, Anthropic engineering blog, and the arXiv paper | Substantiates the discipline framing; enables learners |
| FR-S3 | Update `README.md` banner image alt text and any image filename reference to stay consistent with new tagline | Polish |
| FR-S4 | Update `skills/bump-version/SKILL.md` or add a note to `/bump-version` workflow to check metadata consistency (prevent future drift) | Durability of the unification from S3 |

### 4.3 Could Have

| ID | Requirement | Rationale |
|----|------------|-----------|
| FR-C1 | Add a comparison table showing "sd0x-dev-flow vs other harness tools (Devin, Cline, Aider, Cursor)" mapping which sub-problems each covers | Strong positioning but requires independent verification of competitor coverage |
| FR-C2 | Create a `docs/harness-engineering.md` companion document explaining the discipline with sd0x-dev-flow as the running example | Learning artifact, lower priority than README restructure |
| FR-C3 | Update `CLAUDE.template.md` if it contains any tagline or description text | Consistency for new projects using the template |

### 4.4 Won't Have (This Iteration)

| ID | Excluded | Reason |
|----|----------|--------|
| FR-W1 | Renaming plugin.json `name` | C1 — breaks existing users |
| FR-W2 | Renaming GitHub repo slug | C2 — redirect behavior unverified |
| FR-W3 | Migrating lesson log filename | C4 — orphans user state |
| FR-W4 | Changing default `GUARD_MODE` from warn to strict | Separate decision; see Open Questions |
| FR-W5 | Translating "harness engineering" term itself into local scripts (e.g., 韁繩工程) | Per `rules/docs-writing.md` — technical terms stay in English when the locale convention supports it |

## 5. Pattern Map — The "What This Harness Does" Section Skeleton

> **This is the strategic anchor of the rebrand.** The README's new core section uses the following table to prove the harness-engineering claim with concrete code evidence. Each row maps a canonical sub-problem (from Anthropic engineering blog + Martin Fowler + arXiv 2603.05344) to sd0x-dev-flow's actual implementation.

| # | Harness sub-problem (source) | sd0x-dev-flow implementation | Code evidence |
|---|------------------------------|------------------------------|---------------|
| 1 | Tool loop control (Anthropic) | `/codex-review-fast` → `/precommit` auto-loop with sentinel-driven transitions | `rules/auto-loop.md` + `hooks/post-tool-review-state.sh` |
| 2 | Sentinel-driven state machine (emerging pattern) | Two distinct planes. **Reviewer markers** — `✅ Ready` / `⛔ Blocked` / `✅ Mergeable` / `## Overall: ✅ PASS` — are emitted by the review skills and parsed into durable state. **Aggregate machine gates** — `REVIEW_GATE=PENDING\|READY\|BLOCKED` — are emitted by `emit-review-gate.sh`, which produces no emoji markers at all. (`✅ All Pass` is behaviour-layer prose; no hook reads it.) | Reviewer markers: review skills (producer) + `hooks/post-tool-review-state.sh` (parser). Aggregate gate: `scripts/emit-review-gate.sh` (producer) + the same hook's `update_aggregate_gate` (parser) |
| 3 | Context recovery across compaction (Anthropic) | `[AUTO_LOOP_RESUME]` stdout injection after SessionStart(compact) | `hooks/post-compact-auto-loop.sh` — the `[AUTO_LOOP_RESUME]` heredoc |
| 4 | Lifecycle interceptors (Claude Agent SDK) | 5 hook event types dispatched to 8 scripts: PreToolUse / PostToolUse / Stop / SessionStart / UserPromptSubmit | `hooks/*.sh` (8 scripts) + `.claude/settings.json` |
| 5 | Least-privilege **permission posture** (arXiv 2603.05344 discusses capability gating) | Skill frontmatter `allowed-tools` declares a **pre-approval list** — e.g., `/ask` declares no Edit/Write, so those tools are never silently pre-authorised. It is _not_ a hard deny boundary: omitting a tool means it is not pre-approved, not that it is unavailable through the normal permission flow. The enforced boundaries are the hooks (`pre-edit-guard`, `stop-guard`) and `sandbox: 'read-only'` on Codex calls | 81 of 90 public skills declared `allowed-tools` **as of 2026-04-12** (9 inherit default permissions). The 9-skill inheritance gap is the durable figure; the totals move with the catalog — 89 of 98 when re-measured 2026-07-25. See the header snapshot table and the re-derivation command. |
| 6 | Defense-in-depth safety (arXiv 2603.05344) | 5 layers: pre-edit-guard → commit-msg-guard → pre-push-gate → stop-guard → sidecar fail-closed marker | `scripts/pre-push-gate.sh` + `scripts/commit-msg-guard.sh` + `hooks/stop-guard.sh` (the jq-unavailable fail-closed branch and the `.blocked` sidecar classification block) |
| 7 | Generator-evaluator split (Anthropic) | The evaluator is a separate model that researches the repo itself — Codex, dispatched on every review cycle. Since 2026-07-26 it is the _only_ reviewer by default; a parallel secondary is opt-in via `--dual` on the branch and plan variants | `rules/codex-invocation.md` + `rules/auto-loop.md` § Review Dispatch |
| 8 | Incremental progress tracking (Anthropic) | `iteration_history.current_round` + `max_rounds` hard cap + `total_rounds_session` strategic reset. The cap is **hook-detected**, and blocks only in `strict` or dual-review mode — under the default `warn` mode `stop-guard.sh` prints to stderr and exits 0, leaving enforcement to the behaviour layer. Fingerprint-overlap plateau detection (3+ rounds ≥50% overlap) is a **designed V2 target, not shipped** — `_update_iteration()` stores per-round counts, not fingerprints, so the cap is the only convergence exit the hook observes at all | `rules/auto-loop.md` § Exit Conditions + [`4-implementation.md`](../auto-loop-evolution/4-implementation.md) §2 (round counter lifecycle) |
| 9 | Human-in-the-loop safety gates (Martin Fowler) | `/dev/tty` confirmation in `pre-push-gate.sh` + `AskUserQuestion` for destructive ops | `scripts/pre-push-gate.sh` (`/dev/tty` read) + `skills/push-ci/SKILL.md` (AskUserQuestion flow) |
| 10 | Self-improvement loop (novel) | Correction → record lesson → promote to rule (3+ recurrences) | `rules/self-improvement.md` + `.claude/sd0x-dev-flow-lessons.md` |

> ### ⚠️ 日期附註（2026-07-26，`96786d1`）——上表第 2、5、7、8 列的後續改寫
>
> `96786d1` 把這四列**就地改寫**成下列文字，覆蓋了 2026-04-12 的原文。**上表不還原**（記錄只增不刪，
> 改回去是第二次改寫）——本文即七月字句，此處再引一次以便對照；四月原文以
> `git show 96786d1^:docs/features/harness-engineering-rebrand/1-requirements.md` 取回。
> 這裡引用的是逐字原句，不是摘要——四列皆以
> `git show 96786d1:docs/features/harness-engineering-rebrand/1-requirements.md` 機械抽出並逐位元組比對。
>
> **第 7 列另有一個一日後的後續**：`f06c0ed`（2026-07-27）對本檔**只**做了一件事——把該列的
> `*only*` 正規化為 `_only_`（強調符號替換，語意不變）。下方引用的是 `96786d1` 的原貌，
> 因此保留 `*only*`；`_only_` 是 `f06c0ed` 之後的形式，兩者不可混引。
>
>     | 2 | Sentinel-driven state machine (emerging pattern) | Two distinct planes. **Reviewer markers** — `✅ Ready` / `⛔ Blocked` / `✅ Mergeable` / `## Overall: ✅ PASS` — are emitted by the review skills and parsed into durable state. **Aggregate machine gates** — `REVIEW_GATE=PENDING\|READY\|BLOCKED` — are emitted by `emit-review-gate.sh`, which produces no emoji markers at all. (`✅ All Pass` is behaviour-layer prose; no hook reads it.) | Reviewer markers: review skills (producer) + `hooks/post-tool-review-state.sh` (parser). Aggregate gate: `scripts/emit-review-gate.sh` (producer) + the same hook's `update_aggregate_gate` (parser) |
>     | 5 | Least-privilege **permission posture** (arXiv 2603.05344 discusses capability gating) | Skill frontmatter `allowed-tools` declares a **pre-approval list** — e.g., `/ask` declares no Edit/Write, so those tools are never silently pre-authorised. It is _not_ a hard deny boundary: omitting a tool means it is not pre-approved, not that it is unavailable through the normal permission flow. The enforced boundaries are the hooks (`pre-edit-guard`, `stop-guard`) and `sandbox: 'read-only'` on Codex calls | 81 of 90 public skills declared `allowed-tools` **as of 2026-04-12** (9 inherit default permissions). The 9-skill inheritance gap is the durable figure; the totals move with the catalog — 89 of 98 when re-measured 2026-07-25. See the header snapshot table and the re-derivation command. |
>     | 7 | Generator-evaluator split (Anthropic) | The evaluator is a separate model that researches the repo itself — Codex, dispatched on every review cycle. Since 2026-07-26 it is the *only* reviewer by default; a parallel secondary is opt-in via `--dual` on the branch and plan variants | `rules/codex-invocation.md` + `rules/auto-loop.md` § Review Dispatch |
>     | 8 | Incremental progress tracking (Anthropic) | `iteration_history.current_round` + `max_rounds` hard cap + `total_rounds_session` strategic reset. The cap is **hook-detected**, and blocks only in `strict` or dual-review mode — under the default `warn` mode `stop-guard.sh` prints to stderr and exits 0, leaving enforcement to the behaviour layer. Fingerprint-overlap plateau detection (3+ rounds ≥50% overlap) is a **designed V2 target, not shipped** — `_update_iteration()` stores per-round counts, not fingerprints, so the cap is the only convergence exit the hook observes at all | `rules/auto-loop.md` § Exit Conditions + [`4-implementation.md`](../auto-loop-evolution/4-implementation.md) §2 (round counter lifecycle) |
>
> **另有兩列屬引用維護、非設計推翻，因此不在還原範圍**：第 3 列與第 6 列的宣稱未變，`96786d1`
> 只把易變的行號引用（`hooks/post-compact-auto-loop.sh:133-144`、`hooks/stop-guard.sh:114-149`）
> 換成穩定描述。那是改善，上表保留其七月形式。
>
> **時序更正**：本段前一版把七月文字說成「hook 輕量化後」的產物——**是錯的**。`96786d1` 當時
> `hooks/post-tool-review-state.sh` 與 `scripts/emit-review-gate.sh` 都還在；hook 輕量化是 2026-08-13
> 的 `0b3b8f5` 才刪掉它們。七月那次改寫與 hook 輕量化無關。

**Why this matters**: most harness implementations (Devin, Cline, Aider, Cursor) cover 2–4 of these sub-problems. sd0x-dev-flow covers all 10, and the README becomes a **grounded tour of each one** — not a feature list.

## 6. Non-Functional Requirements

### 6.1 Ship-Gate NFRs (verifiable at merge time)

| Category | Requirement | Measurable Signal (verifiable before merge) |
|----------|-------------|---------------------------------------------|
| **Metadata consistency** | All three JSON description fields (`plugin.json`, `package.json`, `marketplace.json`) contain identical or harmonized text; skill count matches actual count | `diff` across the three fields shows only structural differences; `/claude-health --scope sync` reports no drift |
| **Locale parity** | All 6 README files (en + 5 locales) carry the new positioning and pattern map | `/readme-i18n-sync --verify` reports all locales within ±5 line count |
| **Brand recall** | "Quality gates that AI can't skip" is still discoverable in README body (not just secondary slogan placement) | `grep -c "Quality gates that AI can't skip" README.md` ≥ 1 |
| **Review compliance** | Every modified doc passes `/codex-review-doc` without `🔴` items | Gate sentinel `✅ Mergeable` emitted |
| **Honesty on mode semantics** | Any tagline claim about "fail-closed" is qualified ("where it counts", "in strict/dual paths") to match actual default `warn` behavior | Text review + grep for "fail-closed" in modified files |
| **No-breakage smoke** | Fresh clone + `/plugin install sd0x-dev-flow@sd0xdev-marketplace` succeeds | Manual test in isolated environment before push |

### 6.2 Post-Release KPIs (non-gating, tracked after merge)

> These are outcome metrics to monitor; failing a KPI does NOT block the merge, but triggers a follow-up investigation.

| KPI | Measurement Window | Threshold |
|-----|--------------------|-----------|
| **Zero user-reported install/update failures** | 7 days after push to main | 0 reports; 1+ reports triggers rollback evaluation |
| **SEO discoverability** | 30 days after push | GitHub search for "harness engineering claude code" returns sd0x-dev-flow in top 10 (manual check) |
| **GitHub Topic traffic** | 30 days after push | At least one inbound star/clone traced to `harness-engineering` topic page (via GitHub Traffic insights) |

## 7. Acceptance Signals

### 7.1 Content Acceptance

- [ ] `plugin.json` description begins with "Harness engineering for Claude Code" or synonymous phrasing
- [ ] `package.json` description text matches `plugin.json` exactly
- [ ] `marketplace.json` description text matches `plugin.json` exactly
- [ ] `README.md` H1 remains `# sd0x-dev-flow` (filename-linked) but tagline area carries the new primary + secondary structure from §8
- [ ] `README.md` contains a section titled "What This Harness Does" or equivalent, rendering the §5 Pattern Map
- [ ] `README.md` preserves "Quality gates that AI can't skip" somewhere visible (as secondary slogan directly under new tagline, per equilibrium decision)
- [ ] All 5 locale READMEs reflect the same changes after `/readme-i18n-sync --full`
- [ ] `CLAUDE.md` Line 1 heading matches the new positioning (content, not filename)

### 7.2 Zero-Breakage Acceptance

- [ ] `.claude-plugin/plugin.json` `name` field unchanged (grep literal equality)
- [ ] `package.json` `name` field unchanged
- [ ] `.claude-plugin/marketplace.json` `name` and `repo` fields unchanged
- [ ] No file rename in `README*.md`, `CLAUDE.md`, `.claude/sd0x-dev-flow-lessons.md`
- [ ] No modification to `hooks/stop-guard.sh` or `hooks/post-tool-review-state.sh` regex patterns matching `sd0x-dev-flow:`
- [ ] No modification to `skills/git-profile/scripts/git-profile.sh` config path literals
- [ ] Fresh clone + `/plugin install sd0x-dev-flow@sd0xdev-marketplace` succeeds in a test environment

### 7.3 Quality Gates

- [ ] All modified `.md` files pass `/codex-review-doc` with `✅ Mergeable`
- [ ] `/claude-health --scope sync` reports no metadata drift across plugin/package/marketplace
- [ ] Skill count in hero block (`<!-- BEGIN:HERO-COUNT -->`) matches actual `ls skills/ | wc -l`

## 8. Tagline Decision Inputs (Upstream Reference for Tech Spec)

> **Boundary note**: Per `/req-analyze` problem-space contract, this section does NOT finalize implementation copy. It captures the **attribute requirements** that any final tagline must satisfy (§8.0) plus a **candidate equilibrium** from `/codex-brainstorm` (§8.1) and the **debate evidence trail** (§8.2) that tech-spec may adopt, refine, or reject. Final exact copy is ratified in `2-tech-spec.md`.

### 8.0 Tagline Attribute Requirements (requirements-level)

Any final tagline MUST satisfy:

| ID | Attribute | Rationale |
|----|-----------|-----------|
| TA-1 | Contains the keyword "harness" or "harness engineering" in the first line | SEO discoverability (see FR-M8); the entire rebrand hinges on this term |
| TA-2 | Uses an ownership-claim structure (e.g., "The X for Y") rather than a label/taxonomy structure | Memorability — category labels lose recall |
| TA-3 | Preserves "Quality gates that AI can't skip" somewhere visible (primary or secondary) | Brand equity + literal truthfulness in strict/dual mode (see S2) |
| TA-4 | Any "fail-closed" claim is qualified to match actual default `warn` mode behavior | Honesty — `hooks/stop-guard.sh` defaults to warn, strict only in specific paths |
| TA-5 | Fits naturally into all 5 locale translations (zh-TW, zh-CN, ja, ko, es) | S4 — avoid English-only metaphors |
| TA-6 | Cites concrete mechanisms (dual review / state machine / compaction recovery) rather than abstract benefits | Substance-over-hype — prevents "buzzword rebrand" failure mode |
| TA-7 | Primary tagline total length ≤ 35 English words across both lines | 3-second comprehension test |

### 8.1 Candidate Equilibrium (from `/codex-brainstorm`, 2-round adversarial debate)

> The following candidate was produced by adversarial debate between Claude and Codex. It is offered as a starting point for tech-spec, not a frozen requirement.

#### 8.1.1 Primary Tagline (two-line structure)

**English**
- L1: **The harness layer for Claude Code.**
- L2: **A reference implementation of harness engineering — hook-enforced dual review, state-machine gates that survive context compaction, and fail-closed safety where it counts.**

**zh-TW**
- L1: **給 Claude Code 的 harness 層。**
- L2: **harness engineering 的參考實作——以 hook 強制雙重審查、能扛過 context compaction 的狀態機關卡，在關鍵節點採取 fail-closed 安全機制。**

#### 8.1.2 Secondary Slogan (preserved)

- EN: _Quality gates that AI can't skip_
- zh-TW: 沿用既有翻譯
- Placement: directly beneath primary tagline, smaller emphasis, acts as memorable recall line

#### 8.1.3 Unified JSON Description (plugin / package / marketplace)

```
Harness engineering for Claude Code — hook-enforced dual review, state-machine gates, and fail-closed safety where it counts. 92 skills, 15 agents, 8 lifecycle hooks.
```

#### 8.1.4 GitHub "About" description (≤350 chars, user operation in GitHub UI)

```
The harness layer for Claude Code — a reference implementation of harness engineering with hook-enforced dual review, state-machine gates that survive context compaction, and fail-closed safety where it counts. Quality gates that AI can't skip.
```

Measured length: 244 characters (`wc -m` verified). GitHub About allows ≤350.

### 8.2 Debate Evidence Trail

| Round | Arguer | Attack / Claim | Outcome |
|-------|--------|----------------|---------|
| R1 | Claude (Position A) | Memorable hook > SEO keyword density | Stood |
| R1 | Codex (Position B) | SEO keyword density > memorability; primary line should be "AI Agent Harness Engineering for Claude Code." | Stood initially |
| R2 | Claude attacks Codex: noun-phrase is a category label, not a claim | — | Codex conceded |
| R2 | Claude attacks Codex: "AI Agent" prefix is redundant in a Claude Code plugin context | — | Codex conceded |
| R2 | Claude attacks Codex: Codex flagged warn-mode nuance in its own research but then used "fail-closed stop guards" in its D1 subline — contradiction | — | Codex verified via independent `grep GUARD_MODE hooks/stop-guard.sh` read, conceded, chose "configurable / where it counts" qualifier |
| R2 | Codex attacks Claude: "reference implementation" reads as "example repo, not production-ready" | — | Claude rebutted: this is the strategic positioning for the harness-learner audience, not a bug |
| R2 | Codex independent finding: metadata inconsistency (90+/100+/92) undermines rebrand credibility | — | Claude accepted as FR-S1 (should-have, must ship in same batch) |

## 9. Open Questions

| # | Question | Suggested Resolution |
|---|----------|---------------------|
| Q1 | Does Claude Code plugin install/upgrade follow GitHub repo redirects (relevant for future repo rename, not this iteration)? | Manual test in isolated environment before any future rename — **not blocking this rebrand** |
| Q2 | Should the default `GUARD_MODE` change from `warn` to `strict` so that "Quality gates that AI can't skip" becomes literally true for fresh installs? | Solution-space concern — suggest `/feasibility-study guard-mode-default` as separate investigation |
| Q3 | Should we create a dedicated `docs/harness-engineering.md` primer document in addition to the README restructure? | Scope decision — currently captured as FR-C2 (could-have); reconsider during tech-spec |
| Q4 | Should the rebrand include updating the banner image (`banner.jpg`) to visually reflect the harness-engineering theme? | Out of tech scope — defer to a future visual refresh |
| Q5 | Does `/claude-health` currently check description consistency across the three JSON files? If not, should we add this check as part of FR-S4? | Investigate during tech-spec — may become a small `/claude-health` extension |

## 10. Research Provenance

This requirements document integrates findings from prior `/deep-research harness engineering` multi-agent research (4 parallel researchers: authoritative sources / code case study / community practice / install-upgrade mechanics) and a 2-round `/codex-brainstorm` tagline debate.

| Source | Contribution to this doc |
|--------|-------------------------|
| Shard A (authoritative sources) | §1.2 Why 2, §2.3 assumption on term stability, §5 Pattern Map theoretical backing, §4.2 FR-S2 references list |
| Shard B (sd0x-dev-flow code case study) | §5 Pattern Map code evidence column, §1.3 root problem scale metrics (2,021 lines, 92 skills) |
| Shard C (community experience) | §1.2 Why 2 industry consensus, §8 tagline debate community-voice inputs |
| Shard D (install/upgrade mechanics) | §2.1 all hard constraints, §2.4 out of scope, §7.2 zero-breakage acceptance, §9 Q1 |
| `/codex-brainstorm` tagline debate | §8 entire tagline decision, §2.2 S3 metadata consistency, §8.2 debate evidence trail |

---

> **Next step**: Run `/tech-spec harness-engineering-rebrand` to generate `2-tech-spec.md`, which will specify the exact file edits, the `/readme-i18n-sync --full` invocation plan, the GitHub UI operations checklist (for you, not Claude), and the verification sequence.
