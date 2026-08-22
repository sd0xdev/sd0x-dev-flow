# Pre-Push Gate: Fix `/dev/tty` Detection and Install Guidance

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: In Progress
> **Note**: r2/r3/r4 構成一個原子發佈集（opt-in 生命週期 + 授權契約 + 下游轉述，三單須一起合併）。本單為純缺陷修復，不屬該集合，可獨立落地
> **Priority**: P1
> **Tech Spec**: Pending（缺陷明確，直接實作；範圍擴大再補）

## Background

`scripts/pre-push-gate.sh:107` 以 `[ ! -c /dev/tty ]` 判斷有無終端機。2026-08-15 於背景 session 實測：device node 存在但**開不起來**（`/dev/tty: Device not configured`），此判斷未攔截，控制流落到 `:117` 的 `read`，`CONFIRM` 保持空字串，最終印出 `pre-push-gate: Push aborted by user.` —— 沒有任何人中止過。行為本身 fail-closed 正確（退出碼 1，推送被擋），但**診斷訊息說謊**，會把「環境無終端機」誤導成「使用者拒絕」，操作者據此採取的復原動作會是錯的。

同檔 `:3` 宣稱「Install as git pre-push hook via `/install-scripts`」為不實敘述：`/install-scripts` 只把腳本複製到 `.claude/scripts/`，實際接上 git hook 的是 `/codex-setup` Phase 3（`skills/codex-setup/SKILL.md:50,61`）。

## Requirements

- 以實際開啟 file descriptor 取代 `[ -c ]` 字元裝置檢查，作為終端機可用性的判準
- 「無終端機」與「使用者輸入非 yes」必須印出可區分的訊息，兩者皆維持非零退出
- 修正檔頭安裝指引，指向真正安裝 hook 的來源

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `scripts/pre-push-gate.sh` 的 tty 偵測與檔頭註解、對應 regression test |
| Out | hook 安裝生命週期（r2）；`rules/`／`skills/push-ci/`／README 的授權契約敘述（r3）；cookbook 與其他 feature 文件的轉述（r4） |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `scripts/pre-push-gate.sh` | Modify | `:3` 安裝指引修正；`:107-123` tty 偵測改為開 fd，訊息分流 |
| `test/scripts/pre-push-gate.test.js` | Modify | 現有 9 條之外補雙向 regression |

> **本表與 § Background 的行號為 2026-08-15 的座標（2026-08-20 round 16 補記）**。落地後 tty 區塊位於 `:108-131`，`:3` 的檔頭仍在原位。動工前寫下的目標清單本身是記錄，不改寫成今日行號；現況定位見 Progress 的 Development 格。

## Acceptance Criteria

- [x] tty 偵測改以實際開啟 fd 判定（`exec 3</dev/tty` 或等效），開不起來即走「無終端機」分支
- [x] 「無終端機」訊息不再包含 `aborted by user` 字樣，且明示成因為環境無互動終端
- [x] 「使用者輸入非 yes」仍印出中止訊息；兩條路徑退出碼皆為非零（fail-closed 不變）
- [x] `scripts/pre-push-gate.sh:3` 指向 `/codex-setup`（及手動 `cp` 備援），不再宣稱 `/install-scripts`
- [x] regression test 雙向覆蓋（@rules/testing.md § Conventions 的 Guards 列）：無終端機 → 走無終端機分支並印正確訊息；有終端機且輸入 `yes` → 放行且退出碼 0
- [x] 第三條 regression：有終端機但輸入非 `yes` → 印使用者中止訊息、不含無終端機診斷、退出碼非零（現有 9 條測試無任何一條斷言此訊息）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 背景 session 實測重現；缺陷定位於 `:107` 落穿至 `:117` |
| Development | Done | `scripts/pre-push-gate.sh` 改以 `{ exec 3</dev/tty; } 2>/dev/null` 實際開啟 fd 判定（`:115`）；無終端機訊息改為 `Cannot open /dev/tty — no interactive terminal in this environment.`、不含 aborted by user（`:116`）；使用者中止訊息 `Push aborted by user.` 保留在輸入非 `yes` 的分支（`:130`）；檔頭安裝指引改指 `/codex-setup`（`:3`）。**更正（2026-08-20 round 16）**：本格前一版寫 `:21`／`:22`／`:36`，那是實作**中途**的行號，落地後三者分別位於上列位置——重新推導時 `:21` 落在 `release/*` 註解、`:22` 與 `:36` 落在空行與段落註解上。行號請以訊息字串 grep 現場推導 |
| Testing | Done | `test/scripts/pre-push-gate.test.js` 由 9 條增至 17 條，三方向皆覆蓋（無終端機／有終端機且 yes／有終端機且非 yes）。**更新（2026-08-21）**：其後又補 2 條（標頭安裝者歸屬的正反向守衛，見 `review-log-adequacy-gate.md` 的 r1 缺口列），現值 **19** 條——推導：`grep -c '^test(' test/scripts/pre-push-gate.test.js` → 19，`git show HEAD:test/scripts/pre-push-gate.test.js \| grep -c '^test('` → 9。「17」是補測前的快照，保留原文。**再更正（2026-08-21 round 27）**：上句的「現值 **19** 條」也已過期，同樣保留原文不改——其後為 `pre-push-gate.sh` 的推送形式分流補了 4 條（`REFLINES:0` 無旗標非快轉 vs `REFLINES:1` lease-force），同一指令 `grep -c '^test(' test/scripts/pre-push-gate.test.js` 現回報 **23**。此格的四個數字 9 → 17 → 19 → 23 是四個時間點的快照，不是同一個值的四次改寫 |
| Acceptance | Blocked | code_review 於 round 30 為 ⛔ Blocked 並觸及 `thorough` 30 輪上限；因屬 security 變更，依 @rules/auto-loop.md § Cap Diagnostic Protocol 直接走 ⚠️ Need Human。**未關閉的缺陷全部位於 `skills/smart-rebase/`**——該檔是 2026-08-16 使用者核准 E1 範圍擴大才納入的，不屬本單原範圍，但與本單共用同一個 code 平面 gate，故一併阻塞。詳見 [`../../ref-name-hardening/4-implementation.md`](../../ref-name-hardening/4-implementation.md) § 1（**路徑更正，2026-08-20**：原寫 `4-implementation.md § 1`，該段已於同日抽離至 `ref-name-hardening`，本單同名檔的 § 1 現為 formatter，非 smart-rebase）（**進度更正，2026-08-21**：`skills/smart-rebase/` 的重新設計已於 2026-08-20 依使用者裁示**抽離為獨立 feature** `docs/features/ref-name-hardening/`，連同其需求單。因此「未關閉的缺陷全部位於 `skills/smart-rebase/`」這句**已不再是本單當前的阻塞描述**：本單自己的 code 平面變更（`scripts/pre-push-gate.sh`、`skills/push-ci/SKILL.md`、`skills/codex-setup/SKILL.md`、`rules/*.md`）與該 feature 共用同一個 code 平面 gate，而該 gate 仍為 ⛔ Blocked——但現在的直接原因是 `thorough` 輪次預算已用盡（使用者授權至 round 32，已用畢），依 @rules/auto-loop.md § Cap Diagnostic Protocol 的 anti-loop budget，同一變更第二次觸頂即 ⚠️ Need Human、不再做第二次診斷。本格保留原文以存記錄，此註記說明其時態）|

## References

- 缺陷首次觀測：2026-08-15 `/push-ci` 於背景 session 推送 `main` 被擋，訊息誤報 aborted by user
- 腳本引入 commit：`6370ad3` — feat: Adds defense-in-depth push safety with git pre-push hook
- 姊妹單：[r2 — `/codex-setup` opt-in 生命週期](./2026-08-15-push-gate-optin-r2.md)
- 姊妹單：[r3 — 推送授權契約（方案 A）](./2026-08-15-push-gate-optin-r3.md)
- 姊妹單：[r4 — 下游轉述一致性掃描](./2026-08-15-push-gate-optin-r4.md)

> **2026-08-21 更正（記錄還原）**
>
> 頁首 `Tech Spec` 那行上一輪被就地改寫成指向 `../2-tech-spec.md` 的連結。原句已還原：撰寫當時
> 這張單確實沒有 tech spec，寫著 `Pending` 是當時成立的事實，把它改成今天的連結等於用後見之明覆寫
> 記錄。實際的關聯改以本註記表述——設計面現在落在
> [`../2-tech-spec.md`](../2-tech-spec.md) § 2.2（本單為純缺陷修復，無獨立設計面）。
>
> 這是與 r4 § References 同一類的錯誤，同一輪各犯一次：request ticket 是記錄，可變欄位只有
> Status／Progress 表／AC 勾選／Progress.Note 四項（`skills/create-request/SKILL.md` § Phase 4.5），
> `Tech Spec` 不在其中。上一輪我掃自己的就地改寫時，把 `Tech Spec` 連同那四項一起濾掉，於是掃出
> 「只有一處」——漏的不是證據，是把不可變欄位算進了可變集合。

> **2026-08-22 更正（round 75 自查）**
>
> `## Acceptance Criteria` 第四條寫的 `scripts/pre-push-gate.sh:3`，行號已經漂了：該檔的檔頭註解在
> round 53 加入第二個提示類別（改寫歷史）的說明後長了兩行，`/codex-setup` 現在落在 `:5`、手動 `cp`
> 備援落在 `:6`，`:3` 落在「兩個獨立類別，問兩個不同問題」那句上。
>
> **AC 的實質仍然成立**（檔頭指向 `/codex-setup`、不再宣稱 `/install-scripts`），所以勾選狀態不變，
> 原文也不改——AC 的文字是需求陳述，不在 `skills/create-request/SKILL.md` § Phase 4.5 允許就地變動的
> 四個欄位裡。這與同檔 Progress 表 Development 格 2026-08-20 那筆更正是同一類，該格當時就寫下了正確
> 的作法：「行號請以訊息字串 grep 現場推導」。這次是同一個教訓在 AC 欄再現一次——那句指示當時只寫進
> 了 Progress 格，沒有涵蓋到本檔其餘引用行號的地方。

> **2026-08-22 收尾註記（round 81，使用者裁示停手）**
>
> 使用者在 round 80 之後裁示：對當時那棵樹再派一次 code + doc review，**不論回 Ready 或 Blocked
> 都停下來交接**，不再進入修復迴圈。round 81 兩個平面都回 blocked——code `⛔ Blocked`
> （`gate_reason=IN_SCOPE_BLOCKING`，3 筆：1×P1 + 2×P2）、doc `⛔ Needs revision`（4×P2）。
> 七筆**全部開著、未修**，逐筆內容記在
> [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § Round 81。
>
> 本單 Status 維持 `In Progress`，AC 維持 6/8——round 79–81 做的是內部強化（`readonly`
> 拒絕紀錄凍結、Husky 接線判定的三次收窄），沒有推進任何一條 AC。未勾選項全部是品質閘
> （`/codex-review-fast`、`/precommit`、`/codex-review-doc`）、需要 commit 才成立的
> 「同一批落地」條款，或先前已裁示刻意不勾的項目。
>
> 停手時的實測狀態：全測試套件 4097 tests / 4093 pass / 0 fail / 4 skipped；
> `node scripts/check-comment-blocks.js` exit 0（18 筆既有 WARN、0 BLOCK）。
> `/precommit`、Adequacy Gate、Doc Sync 這一輪都沒有抵達，依 `rules/auto-loop.md` 的終局完成
> 不變式，這批變更**尚未完成**，只是停在可交接的位置。
