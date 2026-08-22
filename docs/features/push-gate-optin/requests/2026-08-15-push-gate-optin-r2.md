# Pre-Push Gate: Make Hook Install Opt-In Across the `/codex-setup` Lifecycle

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: In Progress
> **Note**: ⚠️ 本單與 [r3](./2026-08-15-push-gate-optin-r3.md)、[r4](./2026-08-15-push-gate-optin-r4.md) **同屬一個原子發佈集**，三單必須一起合併（見 Background）。刻意不使用 `Depends On`：那表達的是先後，而此處的約束是原子性。r1 為純缺陷修復，不受此約束
> **Priority**: P1
> **Tech Spec**: Pending（方案已定；範圍擴大再補）

## Background

`/codex-setup` Phase 3 目前**無條件**安裝 `commit-msg` 與 `pre-push` 兩個 git hook（`skills/codex-setup/SKILL.md:50,61`）。使用者要求 `pre-push` 改為預設不裝、明示要求才裝。（順帶一提，`/install-scripts` 從未接上 git hook，它只把腳本複製到 `.claude/scripts/`；repo 多處宣稱由它安裝為不實敘述，該部分由 r1 與 r3 分頭修正。）

opt-in 不是只改安裝那一步：`/codex-setup` 有 `init` / `doctor` / `sync` 三個 subcommand（`:18-20`），後兩者會各自推翻 opt-in ——

| Subcommand | 現行行為 | 對 opt-in 的破壞 |
| ---------- | -------- | ---------------- |
| `doctor` | 「Hooks installed → 檔案不存在即 Fail」（`:117`） | 刻意不裝 `pre-push` 會被判成安裝損壞 |
| `sync` | 「Re-copy hook scripts (overwrite if changed)」（`:126`） | 未經新的明示要求就把 `pre-push` 裝回去 |

因此 opt-in 必須以**完整狀態機**定義，而非單點修改 Phase 3。

**原子發佈集（r2 + r3 + r4）**：分開落地，無論何種順序都留下不一致的中間態 —— 本單先落地，hook 預設消失但規則層仍宣稱它是 terminal credential，出現無授權依據的真空；r3 先落地，README 宣告 `pre-push` 為 opt-in 但安裝器仍無條件安裝（`skills/codex-setup/SKILL.md:50,61`），文件與實作矛盾。r4 的下游轉述同樣無法靠排先後解決（見該單 Background）。因此 **r2、r3、r4 三單須同批落地**，而非排先後。

## Requirements

- `pre-push` 改為 opt-in；`commit-msg` 維持預設安裝（它守護 attribution anchor，且不阻擋非互動作業）
- `init` / `sync` / `doctor` 三條路徑對「刻意未安裝」與「已安裝」皆給出一致且可預期的行為
- `install-state.json` 需能區分這兩種狀態，供 `sync` 與 `doctor` 判讀
- 升級既有專案不得靜默移除已安裝的 `pre-push` hook

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `skills/codex-setup/SKILL.md` 的 init/sync/doctor/state 四處、`test/skills/codex-setup.test.js` |
| Out | `scripts/pre-push-gate.sh` 本身（r1）；`rules/`、`skills/push-ci/`、README 的授權契約敘述（r3）；cookbook 與其他 feature 文件的轉述（r4）；`/install-scripts` 的複製行為不變 |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `skills/codex-setup/SKILL.md` | Modify | `:48-62` Phase 3 opt-in；`:76-98` Phase 5 state；`:108-121` doctor；`:123-128` sync |
| `test/skills/codex-setup.test.js` | New | 目前不存在；CLAUDE.md 規則 5 要求 SKILL.md 對應測試 |

> **上表與 § Background 的行號都是 2026-08-15 的座標，不是現況**（2026-08-20 round 16 補記）。兩處記的都是動工前的狀態，故不改寫；對應的現行位置一律以**節名**標定，行號請以 `grep -n '^## \|^### Phase' skills/codex-setup/SKILL.md` 現場推導：
>
> | 開單時的行號 | 現行節名 |
> | ------------ | -------- |
> | 上表 `:48-62` | `### Phase 3: Multi-Mode Hook Install` |
> | 上表 `:76-98` | `### Phase 5`（install-state 檔） |
> | 上表 `:108-121`、Background `:117` | `## doctor` § Checks |
> | 上表 `:123-128`、Background `:126` | `## sync` |
> | Background `:50,61` | `### Phase 3: Multi-Mode Hook Install`（無條件安裝兩個 hook 的原始敘述） |
> | Background `:18-20` | `## Subcommands` |
>
> 節名而非行號，是因為該檔在 opt-in 落地後每一輪 review 都還在增長；用行號更正行號漂移只會把同一個缺陷推遲一輪。

## Acceptance Criteria

- [x] `init` 預設只安裝 `commit-msg`；`pre-push` 需明示 opt-in，且 SKILL.md 指名該 opt-in 介面（旗標或詢問，擇一寫定）
- [x] Phase 5 `install-state.json` 以明確狀態區分「刻意未安裝」與「已安裝」，非以欄位缺漏表示
- [x] `sync` 在 `pre-push` 未安裝時不得安裝它；已安裝時照常更新且不移除
- [x] `doctor` 對刻意未安裝的 `pre-push` 回報健康（不列為 Missing/Fail）；已安裝時維持現行存在性檢查（`:117` 目前只驗存在，雜湊比對僅適用 AGENTS.md `:115`，本單不新增 hook 雜湊驗證）

  > **落地形式（2026-08-20 round 16 補記）**。本條的 `:117`／`:115` 是 2026-08-15 的座標，皆已位移；現行對應位置是 § doctor § Checks 的 `state status × sd0x wiring on disk` 矩陣：`installed × Present` ✅、`installed × Absent` ❌、`declined × Absent` ✅（印 `pre-push: not installed (opt-in)`）、`declined × Present` ⚠️、`unknown` ⚠️。該節末並明寫「Wiring presence is the whole check for an installed hook；hash comparison applies to AGENTS.md only」，即本條「不新增 hook 雜湊驗證」如實落地
- [x] `test/skills/codex-setup.test.js` 覆蓋五種狀態轉移：`init` 無 opt-in、`init` 明示 opt-in、`sync` 於未安裝時、`sync` 於已安裝時、`doctor` 於兩種狀態
- [ ] 本單與 r3、r4 於**同一批**落地（同一組 commit / 同一次合併），三者不得分開釋出 —— 分開落地即為缺陷，不是進度

  > **⛔ 已被違反（2026-08-21 查證）**：§ Background 預言的中間態之一已經發生。查證指令、輸出與調和方式記於[`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § 原子發佈集破功的查證。本條留空的意義因此是「已發佈的不一致尚待調和」，不是「尚未開始」
- [ ] Pass `/codex-review-fast`（tier `thorough` —— push safety 屬 security 變更，Anchor Register #3）
- [ ] Pass `/precommit`
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 追出真正安裝路徑為 `/codex-setup` Phase 3；doc review 補出 sync/doctor 兩條會推翻 opt-in 的路徑 |
| Development | Done | `skills/codex-setup/SKILL.md` 全生命週期 opt-in，五處以節名標定：§ Arguments 的 `--with-push-gate` 旗標、§ Phase 3 的 hook 安裝表與其「Skipped 不等於 declined」解析矩陣、§ Phase 5 的 install-state schema 明確寫出 `declined` 狀態（非以欄位缺漏表示）、§ sync 不裝已 declined 者亦不移除已裝者、§ doctor 視 declined 為健康並仍列出該列。行號一律不記——該檔每輪 review 仍在增長；位置以 `grep -n '^## \|^### Phase' skills/codex-setup/SKILL.md` 現場推導 |
| Testing | Done | 新增 `test/skills/codex-setup.test.js`，涵蓋五種狀態轉移，另含 unknown→opt-in、uninstall、section 隔離等邊界。數量**不寫定**——它們每輪 review 都可能變，寫死的值下一輪就被自己的推導指令推翻（round 18 即抓到斷言數已由 58 變 60）。現值一律以 `grep -c '^test(' test/skills/codex-setup.test.js` 與 `grep -o 'assert\.[a-zA-Z]*' test/skills/codex-setup.test.js \| wc -l` 現場推導；本條的驗收判準是五種狀態轉移各有覆蓋，不是條數 |
| Acceptance | Blocked | code 平面 gate 仍為 ⛔ Blocked，**直接原因是 `thorough` 輪次預算已用盡**（使用者授權至 round 32，已用畢）：依 @rules/auto-loop.md § Cap Diagnostic Protocol 的 anti-loop budget，同一變更第二次觸頂即 ⚠️ Need Human、不再做第二次診斷。本單自己的 code 平面變更為 `scripts/pre-push-gate.sh`、`skills/push-ci/SKILL.md`、`skills/codex-setup/SKILL.md`、`rules/*.md`。原先阻塞本單的 `skills/smart-rebase/` 缺陷已於 2026-08-20 依使用者裁示**抽離為獨立 feature** [`../../ref-name-hardening/`](../../ref-name-hardening/4-implementation.md)（連同其需求單），不再是本單的阻塞來源 |

## References

- 審查層級依據：`rules/auto-loop.md` § Tiers —— security 變更一律以 `thorough` 審
- 姊妹單：[r1 — `/dev/tty` 偵測與安裝指引修復](./2026-08-15-push-gate-optin-r1.md)
- 同批單：[r3 — 推送授權契約（方案 A）](./2026-08-15-push-gate-optin-r3.md)、[r4 — 下游轉述一致性掃描](./2026-08-15-push-gate-optin-r4.md)

> **2026-08-21 更正（記錄還原）**
>
> 頁首 `Tech Spec` 那行上一輪被就地改寫成指向 `../2-tech-spec.md` 的連結。原句已還原：撰寫當時
> 這張單確實沒有 tech spec，寫著 `Pending` 是當時成立的事實，把它改成今天的連結等於用後見之明覆寫
> 記錄。實際的關聯改以本註記表述——設計面現在落在
> [`../2-tech-spec.md`](../2-tech-spec.md) § 2.1（opt-in 生命週期狀態機）。
>
> 這是與 r4 § References 同一類的錯誤，同一輪各犯一次：request ticket 是記錄，可變欄位只有
> Status／Progress 表／AC 勾選／Progress.Note 四項（`skills/create-request/SKILL.md` § Phase 4.5），
> `Tech Spec` 不在其中。上一輪我掃自己的就地改寫時，把 `Tech Spec` 連同那四項一起濾掉，於是掃出
> 「只有一處」——漏的不是證據，是把不可變欄位算進了可變集合。

> **2026-08-22 收尾註記（round 81，使用者裁示停手）**
>
> 使用者在 round 80 之後裁示：對當時那棵樹再派一次 code + doc review，**不論回 Ready 或 Blocked
> 都停下來交接**，不再進入修復迴圈。round 81 兩個平面都回 blocked——code `⛔ Blocked`
> （`gate_reason=IN_SCOPE_BLOCKING`，3 筆：1×P1 + 2×P2）、doc `⛔ Needs revision`（4×P2）。
> 七筆**全部開著、未修**，逐筆內容記在
> [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § Round 81。
>
> 本單 Status 維持 `In Progress`，AC 維持 5/9——round 79–81 做的是內部強化（`readonly`
> 拒絕紀錄凍結、Husky 接線判定的三次收窄），沒有推進任何一條 AC。未勾選項全部是品質閘
> （`/codex-review-fast`、`/precommit`、`/codex-review-doc`）、需要 commit 才成立的
> 「同一批落地」條款，或先前已裁示刻意不勾的項目。
>
> 停手時的實測狀態：全測試套件 4097 tests / 4093 pass / 0 fail / 4 skipped；
> `node scripts/check-comment-blocks.js` exit 0（18 筆既有 WARN、0 BLOCK）。
> `/precommit`、Adequacy Gate、Doc Sync 這一輪都沒有抵達，依 `rules/auto-loop.md` 的終局完成
> 不變式，這批變更**尚未完成**，只是停在可交接的位置。
