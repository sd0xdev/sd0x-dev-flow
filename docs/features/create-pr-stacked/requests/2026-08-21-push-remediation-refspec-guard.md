# Push remediation 指令：refspec 前綴與 shell 引號兩道缺口

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-08-21
> **Status**: Pending
> **Priority**: P0
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec/2-tech-spec.md)
> **Note**: 本單為 **抽離單**——缺陷是在 `push-gate-optin` round 38 的 code review 中被發現的 out-of-scope critical，依 `@rules/scope-discipline.md` § Closed-Set Options **選項 2（抽成獨立變更）** 立此單，使用者於 2026-08-21 裁示。缺陷本身為 pre-existing，非 push-gate-optin 分支所引入

## Background

`skills/create-pr/references/stack-mode.md:124` 對「遠端缺 ref」的補救，提供一條**可複製貼上**的指令：

```
git push origin -- 'b1' 'b2' 'b3'
```

`--` 在這裡給的是**假的保證**。它擋的是選項解析，而這條指令有兩個與選項解析無關的缺口，各自獨立成立。

### 缺口 1 — `+` 前綴是 refspec 語意，不是選項

`git push` 的 refspec 允許 `+<src>[:<dst>]` 前綴，manpage 逐字寫著 *"The + is optional and does the same
thing as `--force`"*，以及 *"origin +master to force a push to the master branch"*。`--` 不會、也不該
阻止這個解讀——它區隔的是「選項」與「非選項」，而 `+main` 本來就是非選項。

於是：**一個名為 `+main` 的本地分支，會讓這條指令強制更新遠端 `main`。**

| 量測 | 結果 |
|------|------|
| `git check-ref-format 'refs/heads/+main'` | rc=0——**`+main` 是合法 ref 名** |
| `git branch '+main'`（拋棄式 fixture repo） | 建立成功，`for-each-ref` 可見 `refs/heads/+main` |
| `git push` manpage | `The + is optional and does the same thing as --force.` |

> 推送端的實際行為**未實測**：驗證它需要真的執行 `git push`，而 `@rules/discretion.md` Anchor Register #4
> 只授權 `/push-ci`、`/smart-commit --execute`、`/epic-merge` 三個工作流。上表前兩列是實測，第三列是 git
> 自己的文件。實作本單時，推送行為的實測請走 `/push-ci`，或以 `--dry-run` 在使用者核准下取得。
>
> **更正（2026-08-22 round 75）**：上句末尾的「或以 `--dry-run` 在使用者核准下取得」是錯的，原文
> 保留。`git push --dry-run` 仍然是 `git push`——Anchor Register #4 管的是**指令**，不是它會不會真的
> 動到遠端，而該 Register 的例外清單裡沒有「經核准的 dry-run」這一條。同一段列出的三個工作流本身沒
> 寫錯，但要提醒的是：`/smart-commit --execute` 的授權只涵蓋 `git add` 與 `git commit`，**不含**任何
> push 形式，所以三者之中能承載這項實測的只有 `/push-ci` 與 `/epic-merge`。實作本單時的正確作法是二
> 擇一：走 `/push-ci`，或把完整指令交給操作者在 agent 之外自己執行。
>
> **再更正（2026-08-22 round 76）**：上一段末尾的「走 `/push-ci`」也達不到目的，原文一樣保留。
> `/push-ci` 的參數面是封閉的（`--timeout`、`--force-with-lease`、`--set-upstream`），它**自己組**
> refspec，永遠是 `<SHA>:refs/heads/<branch>` 的完整安全形式；`/epic-merge` 推的則是它自己那組預定的
> PR head refspec。兩者都無法執行本節要驗證的那一種指令（把 `+main` 這類原始 refspec 交給 `git push`）
> ——**工作流的名字不是任意 push 的授權**，把它當成授權正是 Register #4 要防的讀法。所以剩下的路只有
> 一條：完整指令交給操作者在 agent 之外自己跑，把輸出貼回本單；若要在 agent 內做，那是新增一個被明確
> 授權的工作流，屬 Anchor 層級變更，須另行核准。

### 缺口 2 — 合法的分支名可以逃出單引號（本單撰寫時發現，比缺口 1 更重）

`git check-ref-format` 禁止的是空白、控制字元與 `~^:?*[\` 等；**單引號與分號都是合法的 ref 字元**。

| 量測 | 結果 |
|------|------|
| `git check-ref-format "refs/heads/a';id;'b"` | rc=0——**合法** |
| `git branch "a';id;'b"` | 建立成功 |
| 天真單引號包裝後的字串 | `git push origin -- 'a';id;'b'` |

貼進 shell 後那不是一條指令，是三條：`git push origin -- a`、`id`、`b`。**這是可複製貼上指令的命令注入**。

威脅模型要說清楚，不誇大：分支名通常來自使用者自己的 repo，所以這不是隨手可觸發的遠端攻擊面；
可觸發的路徑是**別人取的名字進到你的 ref 空間**——從 fork 取回的 PR 分支、共用 repo 的協作者分支、
自動化建立的分支。一旦進來，觸發只需要使用者照著我們印的指令貼上。

### 缺口 0（無缺陷，記錄以免日後誤改）

`--upload-pack=x` 同樣是合法 ref 名（實測 rc=0），但它**確實**被 `--` 擋住——這正是 `--` 該做的事。
移除 `--` 會開一個現在沒有的洞，所以修法是**在 `--` 之上再加兩道**，不是替換它。

## Requirements

- push remediation 指令改用**完整 refspec** 形式（`refs/heads/<name>:refs/heads/<name>`）——`+` 落在
  `refs/heads/` 之後就只是路徑的一個字元，沒有 force 語意可解讀
- 分支名進入任何 copy-paste 指令前先驗證；含 shell metacharacter（至少 `'`、`;`、```、`$`、`&`、`|`、
  `<`、`>`、換行）者拒絕輸出並改走逐分支 `/push-ci` 路徑。**或**改用不需 shell 引號的輸出形式
- 稽核 `/create-pr` 其他產出 copy-paste 指令的位置——同類缺陷是否只有這一處。這是本單最容易漏的一項：
  修掉被指出的那一行，與修掉這個**類別**，是兩件事

## Acceptance Criteria

- [ ] `stack-mode.md` 的 remediation 指令採完整 refspec，`+main` 不再具 force 語意
- [ ] 分支名驗證落地，`a';id;'b` 這類名字不會被寫進 copy-paste 指令
- [ ] 兩道缺口各附**雙向**測試：`+main` 與 `a';id;'b` 必須被拒，而一般分支名（含合法的 `feat/x-1`）
      必須通過——單向守衛落地當天是綠的，之後才假陽性（`@rules/testing.md` § Conventions）
- [ ] `/create-pr` 全域稽核完成，結果（有無同類缺陷）寫進本單的 Progress.Note
- [ ] `/codex-review-doc` 通過
- [ ] `/precommit` 通過

## Related Files

| 檔案 | 角色 |
|------|------|
| `skills/create-pr/references/stack-mode.md` | 缺陷所在（`:124` 的 remediation 指令） |
| `skills/create-pr/SKILL.md` | 全域稽核對象——其他 copy-paste 指令 |
| `test/skills/create-pr.test.js` | 雙向守衛測試落點 |

## Progress

| 階段 | 狀態 |
|------|------|
| 設計 | Pending |
| 實作 | Pending |
| 測試 | Pending |
| 驗收 | Pending |

> **Progress.Note**（2026-08-21）：本單自 `push-gate-optin` round 38 抽離。缺口 1 為 reviewer 指出，
> 缺口 2 為撰寫本單時發現。兩者皆已以實測坐實（`check-ref-format` 與 `git branch` 於拋棄式 fixture
> repo），推送端行為未實測、原因見上。
