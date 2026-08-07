# Smart Commit Hardening — Technical Spec

## 1. Requirement Summary

- **Problem**: `/smart-commit` 存在三個使用者回報的問題：(1) Git identity 未驗證，多 profile 環境下身份混亂；(2) AI attribution 洩漏（Co-Authored-By Claude 殘留）；(3) Commit 簽名設定不一致，混合簽名/未簽名。
- **Goals**: 在 `/smart-commit` workflow 中加入 identity diagnostics、AI runtime validation、signing diagnostics 三項 pre-flight 檢查，消除上述三類問題。
- **Scope**: 修改 `skills/smart-commit/SKILL.md`、~~`commands/smart-commit.md`~~（v3.0.0 已移除 `commands/`）、`scripts/commit-msg-guard.sh`；新增測試。
- **Origin**: Best Practices Audit（Debate threadId: `019cb7cb-f464-75b2-ba9b-231ecded04d8`）

## 2. Existing Code Analysis

### Related Modules

| Module | 可復用部分 |
| ------ | ---------- |
| `skills/smart-commit/SKILL.md` | 現有 Step 1–6 workflow、AI trailer sanitization regex（`Forbidden Pattern` / `Regex` 表格，三列：`Co-Authored-By AI` / `Generated-by tag` / `Emoji robot tag`） |
| `scripts/commit-msg-guard.sh` | Forbidden pattern regex（**ERE**，`grep -Ei`；早期版本誤記為 BRE）、`ALLOW_AI_COAUTHOR` **narrow opt-in**（移除白名單那一行後其餘樣式照常套用，不是 bypass） |
| ~~`commands/smart-commit.md`~~ | Context block（status/log/branch）——**v3.0.0 已移除 `commands/`**，skill frontmatter 取代之 |
| `rules/git-workflow.md` | Claude git 操作權限定義 |
| `CLAUDE.md:39` | Author attribution 政策、forbidden patterns |

### Files Requiring Changes

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/smart-commit/SKILL.md` | Modify | 新增 Step 1c/1d/1e + runtime validation |
| ~~`commands/smart-commit.md`~~ | ~~Modify~~ | v3.0.0 已移除 `commands/`，不再適用 |
| `scripts/commit-msg-guard.sh` | Modify | Regex 正規化為 ERE + `\b` 字界 |
| `test/scripts/smart-commit.test.js` | New | Identity/AI guard/signing pre-flight 測試 |
| `skills/smart-commit/scripts/smart-commit-execute.sh` | New | `--execute` 的 alloc / commit / verify-last，取代 §3.6 的 inline 設計 |
| `skills/smart-commit/scripts/smart-commit-inspect.sh` | New | 十道唯讀診斷，取代 §3.2–3.4 的 inline fence |
| `test/scripts/smart-commit-inspect.test.js` | New | 診斷腳本的環境剝離、root 錨定、pathspec、arity |
| `docs/features/smart-commit-hardening/4-implementation.md` | New | 實作考古：量測、走過的彎路、每條規則所針對的缺陷；程式碼註解的指標目標 |

## 3. Technical Solution

### 3.1 Architecture Design

```mermaid
sequenceDiagram
    participant C as Claude
    participant G as Git Config
    participant U as User

    C->>G: Step 1c: Identity diagnostics
    G-->>C: user.name/email + origin/scope
    alt Missing identity
        C->>U: HALT + setup guidance
    else Conflict
        C->>U: Ask which profile
    else OK
        C->>C: Record in commit plan
    end

    C->>G: Step 1d: Signing diagnostics
    G-->>C: commit.gpgsign + signingkey + gpg.format
    C->>C: Record signing status

    C->>G: Step 1e: AI guard readiness
    G-->>C: core.hooksPath + hook existence
    C->>C: Record guard status

    C->>C: Step 2: Pre-flight review check (3-tier)
    alt Code files without precommit
        C->>U: HALT + require /precommit-fast
    else Structural .md without precommit-fast
        C->>U: HALT + require /precommit-fast
    else Other .md without doc review
        C->>U: HALT + require /codex-review-doc
    else All tiers passed (fresh)
        C->>C: Continue
    end

    Note over C: Step 3–4 unchanged (grouping + message)

    C->>C: Step 5: Generate message
    C->>C: Behavioral sanitization (strip AI patterns)
    alt --execute mode
        C->>C: Write to temp file
        C->>C: Runtime validation (grep -E)
        alt Validation fails
            C->>U: ABORT + error
        else OK
            C->>G: git commit -F <tmpfile>
        end
    else manual mode
        C->>U: Output commands + checklist
    end
```

### 3.2 Step 1c: Identity Diagnostics（新增）

> **已被取代（§3.2–3.4 共用此註記，設計層而非政策層）**：這三節記錄的是把診斷 fence 直接寫在
> Markdown 裡的原始設計。現行實作把十道唯讀診斷全部移進簽入的
> `skills/smart-commit/scripts/smart-commit-inspect.sh`（`style` / `identity` / `signing` /
> `signature` / `guard` / `collect` / `status` / `scope` / `diff` / `branch`），skill 只發一道
> `/bin/bash -p -- "$INSPECT" <subcommand>`；腳本位置以 repo root 為基準解析，先找安裝副本
> `.claude/scripts/`、再找 `skills/smart-commit/scripts/`。與 §3.6 是同一個方向、同一個理由。
>
> 以下 fence **保留出貨時的形狀**——已退役的 `GIT_ENV="…"` 賦值後再套用（現行為字面前綴，見
> `skills/smart-commit/references/git-environment.md` § 1）。但變數清單本身跟著每輪更新，不凍結在
> 出貨當下的版本：一份過期的清單（例如漏掉 round 19/20 才加入的 `GIT_CONFIG_GLOBAL`／
> `GIT_CONFIG_SYSTEM`）會誤導讀者以為某個管道還開著，這比「形狀不是原始的」更糟。所以這裡是形狀
> 歷史、內容當代的混合體，不是逐位元組的原始紀錄。它的價值在於**每個判定存在的理由**：前綴為何要
> 剝掉整組 `GIT_*`、`-C` 為何必須綁在 root、`--get-all` 為何不能退回 `--get`、hooks 路徑為何用問
> 的。這些是政策層，沒有隨實作搬家而失效，也沒有隨清單增修而失效。
> **要照抄可執行的形狀請看腳本本身。** 實作考古見 [4-implementation.md](./4-implementation.md)。

**位置**: Step 1a/1b 之後，Step 2 之前

**指令**:

```bash
# 讀取有效 identity + 來源。前綴與 -C 的契約見
# skills/smart-commit/references/git-environment.md § 1——診斷與 commit 必須指向同一個 repository
GIT_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR"
REPO_ROOT=$($GIT_ENV git rev-parse --show-toplevel && printf .) || { echo "⚠️ could not resolve the repository root — aborting" >&2; exit 1; }
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
$GIT_ENV git -C "$REPO_ROOT" config --show-origin --show-scope --get-all user.name
$GIT_ENV git -C "$REPO_ROOT" config --show-origin --show-scope --get-all user.email
# 檢查環境變數覆寫
printf "GIT_AUTHOR_NAME=%s\nGIT_AUTHOR_EMAIL=%s\nGIT_COMMITTER_NAME=%s\nGIT_COMMITTER_EMAIL=%s\n" \
  "${GIT_AUTHOR_NAME:-}" "${GIT_AUTHOR_EMAIL:-}" \
  "${GIT_COMMITTER_NAME:-}" "${GIT_COMMITTER_EMAIL:-}"
```

**決策邏輯**:

| 情境 | 判定條件 | 行為 |
|------|---------|------|
| 正常 | `user.name` 和 `user.email` 各解析為單一值 | 靜默繼續，commit plan 顯示 identity |
| 缺失 | `git config --get user.name` 無結果 | **HALT**，輸出 `git config --local user.name "..."` 設定指引 |
| 環境變數覆寫 | `GIT_AUTHOR_*` 或 `GIT_COMMITTER_*` 非空 | ⚠️ 告知使用者 env var 將覆寫 config |
| 衝突 | `--get-all` 返回多個值且解析值不同 | **AskUserQuestion**：列出候選 profile，使用者選擇一次 |
| 衝突（CI/headless） | 衝突 + `CI=true` 環境變數 | **HALT**（fail-closed），輸出修復指引，不靜默繼承 |

**設計原則**:
- **診斷式，非覆寫式**：不使用 `git -c user.name=...` 覆寫，尊重 `includeIf` 設定
- **僅異常時中斷**：正常 identity 解析不產生任何提示
- **衝突 ≠ 多來源**：`includeIf` 產生多個 config 來源但解析為同一值 = 正常

### 3.3 Step 1d: Signing Diagnostics（新增）

> 已被取代：見 §3.2 開頭的共用註記。現行實作為 `smart-commit-inspect.sh signing`（以及 commit
> 後可見性的 `signature`）。

**位置**: Step 1c 之後

**指令**:

```bash
GIT_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR"
REPO_ROOT=$($GIT_ENV git rev-parse --show-toplevel && printf .) || { echo "⚠️ could not resolve the repository root — aborting" >&2; exit 1; }
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
$GIT_ENV git -C "$REPO_ROOT" config --show-origin --get commit.gpgsign 2>/dev/null || echo "unset"
$GIT_ENV git -C "$REPO_ROOT" config --show-origin --get user.signingkey 2>/dev/null || echo "unset"
$GIT_ENV git -C "$REPO_ROOT" config --show-origin --get gpg.format 2>/dev/null || echo "gpg"
```

**決策邏輯**:

| 情境 | 行為 |
|------|------|
| `commit.gpgsign=true` + key 存在 | 顯示 `Signing: enabled (<gpg.format>)` |
| `commit.gpgsign=true` + key 缺失 | ⚠️ 警告：signing 已啟用但 key 未設定 |
| `commit.gpgsign` 未設定 | 顯示 `Signing: not configured (inherit)` |
| `--execute` 模式簽名失敗 | **立即停止**，輸出修復步驟 |

**新增 flags**:

| Flag | 行為 | 預設 |
|------|------|------|
| `--sign` | 本次 batch 強制 `-S` | — |
| `--no-sign` | 本次 batch 強制 `--no-gpg-sign` | — |
| （無 flag） | 繼承現有 git config | ✅ |

**安全措施**: `--sign` / `--no-sign` 使用時需 AskUserQuestion 確認，並警告可能與 branch protection/CI 政策衝突。

**Post-commit 可見性**（`--execute` 模式）:

```bash
GIT_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR"
REPO_ROOT=$($GIT_ENV git rev-parse --show-toplevel && printf .) || { echo "⚠️ could not resolve the repository root — aborting" >&2; exit 1; }
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
$GIT_ENV git -C "$REPO_ROOT" log -1 --format='%G?' # N=unsigned, G=good, U=good-untrusted, etc.
```

### 3.4 Step 1e: AI Guard Readiness（新增）

> 已被取代：見 §3.2 開頭的共用註記。現行實作為 `smart-commit-inspect.sh guard`，且 hooks 路徑
> 解析失敗改為 fail closed（exit 1），不再落到 `guard:missing`——SKILL.md Step 1e 的決策表有對應
> 的第四列。

**位置**: Step 1d 之後

**指令**:

```bash
# `--git-path hooks/…` 本身就已套用 core.hooksPath（含 `~`／`%(prefix)` 展開）與 linked
# worktree，因此用問的、不用自己重算。
GIT_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR"
REPO_ROOT=$($GIT_ENV git rev-parse --show-toplevel && printf .) || { echo "⚠️ could not resolve the repository root — aborting" >&2; exit 1; }
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
HOOK_FILE=$($GIT_ENV git -C "$REPO_ROOT" rev-parse --git-path hooks/commit-msg 2>/dev/null)
# 回答相對於自己的 cwd，而 -C "$REPO_ROOT" 已把 cwd 釘在 root，故相對答案即 root-relative：
# 不需版本旗標、不需額外行程、不需切行。REPO_ROOT 末段含換行由上方 `printf .` sentinel 保住
# （$( ) 會剝除所有尾端換行，而 --show-toplevel 沒有 -z 形式）；sentinel 以 && 連接而非 `;`，
# 否則 printf 的 exit 0 會蓋掉 git 的失敗狀態。推導與實測：
# skills/smart-commit/references/git-environment.md §1。
case "$HOOK_FILE" in
  ""|/*) ;;
  *) HOOK_FILE="${REPO_ROOT}/${HOOK_FILE}" ;;
esac
# 三態必須可分辨：決策表對「存在但不可執行」另有 chmod 指引
if   [ -x "$HOOK_FILE" ]; then echo "guard:installed"
elif [ -f "$HOOK_FILE" ]; then echo "guard:not-executable"
else                           echo "guard:missing"; fi
```

**決策邏輯**:

| 情境 | 行為 |
|------|------|
| Hook 已安裝 + 可執行 | 顯示 `AI guard: active` |
| Hook 未安裝 | ⚠️ 建議安裝（非阻擋）：`/install-scripts commit-msg-guard` |
| Hook 存在但不可執行 | ⚠️ 建議 `chmod +x` |

**重要**：hook 安裝不是 `--execute` 模式的 blocker。runtime validation 提供獨立防線。

### 3.5 Step 2: Pre-flight Review Check（3-tier 策略）

**位置**: Step 1e 之後、分組/訊息生成之前

**目的**: `/smart-commit` 是 commit 前最後一道關卡，pre-flight 確認所有變更已通過對應的 review/precommit 檢查。

**3-tier 分類**:

| Tier | 檔案類型 | 必須通過的檢查 | 說明 |
|------|---------|---------------|------|
| 1 — Code | 程式碼檔案（`.js`, `.ts`, `.sh` 等） | `/precommit` 或 `/precommit-fast` | 包含 lint + test |
| 2 — Structural `.md` | `skills/**/*.md`, `commands/**/*.md` | `/precommit-fast` | 結構性文件影響 skill 行為 |
| 3 — Other `.md` | 其他 `.md`（docs, README 等） | `/codex-review-doc`（per CLAUDE.md） | 文件品質檢查 |
| — | Comments / trivial | 跳過 | 無需檢查 |

**Freshness 條件**: 檢查必須在**當前 session 中、最後一次編輯之後**通過。過期的檢查結果不計入。

**決策邏輯**:

| 情境 | 行為 |
|------|------|
| 所有 tier 對應檢查皆已通過（fresh） | 靜默繼續 |
| Code 檔案未通過 precommit | **HALT**：要求先執行 `/precommit-fast` |
| Structural `.md` 未通過 precommit-fast | **HALT**：要求先執行 `/precommit-fast` |
| Other `.md` 未通過 doc review | **HALT**：要求先執行 `/codex-review-doc` |
| 混合變更（code + docs） | 各 tier 獨立檢查，全部通過才繼續 |

**Policy note**: 此策略刻意比 `auto-loop.md` baseline 更嚴格。`/smart-commit` 作為 commit 前最後關卡，不允許跳過任何 tier 的檢查。auto-loop 在開發迴圈中容許部分寬鬆（例如 Nit exemption），但 `/smart-commit` 不繼承這些豁免。

### 3.6 Runtime Validation（Execute 模式增強）

> **已被取代（設計層，非本節的政策層）**：本節記錄的是 `--execute` 在 Markdown 裡組出
> validate + commit 的原始設計。現行實作把整段移進簽入的
> `skills/smart-commit/scripts/smart-commit-execute.sh`（`alloc` / `commit` / `verify-last`），
> skill 只發一道 `/bin/bash -p -- "$EXECUTE" …`。介面與 exit status 見
> `skills/smart-commit/references/execute-mode.md`。
>
> 以下 fence **保留出貨時的寫法**，理由同 §3.2 的共用註記。本節保留的政策層判定為：temp file
> 不用 heredoc、guard 路徑的解析順序、`ALLOW_AI_COAUTHOR` 不得由環境決定、驗證與 commit 必須在
> 同一個 process。

**位置**: Step 5c，在 `git commit` 之前

**流程**:

```bash
# 1. 建立 temp file，訊息以 Write 工具寫入（不用 heredoc）
#    固定的 `<<'EOF'` 定界符可被注入：訊息中出現一行 EOF 會提前結束 heredoc，
#    其餘內容落入 shell。/create-pr 對同一構造的禁令出於同一理由。
TMPFILE=$(mktemp "${TMPDIR:-/tmp}/smart-commit-msg.XXXXXX") || exit 1

# 2. Runtime validation：直接執行 canonical 執行點，不再自帶一份 validate_msg()
#    舊版在此重寫政策，衍生三個缺陷：`grep … && return 1` 把狀態 2 讀成乾淨
#    （fail-open）、白名單以 -Eiv 剝除而與 hook 的 -Fxv 判定相反、測試複製同
#    一段 shell 因而偵測不到 drift。guard 本身已具備 privileged mode、PATH
#    釘死、LC_ALL=C 與「grep 非 0/1 即中止」。
# 3. 解析 canonical validator：**只走 repo 相對路徑**。此處曾以
#    `${CLAUDE_PLUGIN_ROOT}/scripts/…` 為第一候選，那等於讓呼叫端指定 validator。
#    `GIT_*` 的剝除寫成**單一前綴**並套用到本檔每一個 git 操作。只對 rev-parse
#    剝除是另一個缺陷：guard 來自當前目錄所在的 repo，commit 卻寫入 GIT_* 選定的
#    另一個 repo——同一個問題答了兩次、兩個答案。`--execute` 因此明確定義為
#    「作用於當前目錄所在的 repo」，要換 repo 的人改變當前目錄。
GIT_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR"
# `||` 掛在 substitution 上：後面兩個 strip 是 parameter assignment，永遠成功，
# 守衛寫在它們之後就永遠不會觸發（git-environment.md §1）。
REPO_ROOT=$($GIT_ENV git rev-parse --show-toplevel && printf .) || {
  # 先清理、後診斷：繼承的 `set -e` 下，寫 stderr 失敗會就地結束 shell，
  # 其後的清理永遠不會執行——這裡留在磁碟上的是完整的 commit message。
  rm -f "$TMPFILE" || echo "⚠️ 無法刪除 $TMPFILE" >&2
  echo "⚠️ could not resolve the repository root — aborting" >&2
  exit 1; }
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
GUARD=""
for cand in "$REPO_ROOT/.claude/scripts/commit-msg-guard.sh" \
            "$REPO_ROOT/scripts/commit-msg-guard.sh"; do
  if [ -f "$cand" ]; then GUARD="$cand"; break; fi
done
if [ -z "$GUARD" ]; then
  echo "❌ commit-msg-guard.sh not found — cannot validate" >&2
  rm -f "$TMPFILE"; exit 1     # fail closed：無法驗證即不得提交
fi

# 4. 驗證與 commit 置於同一區塊，中間不插入任何步驟。
#    `ALLOW_AI_COAUTHOR` 為呼叫端可設，預設分支因此以 env -u 清除而非僅是不設定
#    ——guard 與 commit-msg hook 都讀它。SIGN_FLAG 必須在此賦值：behavioural spec
#    的每個 fence 是獨立 shell，未賦值不是「預設為空」而是「由呼叫端決定」。
#    每個狀態都以 `if` 捕捉，不留裸命令——`git commit` 本身也不例外。繼承來的
#    `set -e` 會讓失敗的裸命令在捕捉狀態、刪除訊息檔與輸出中止訊息之前就結束
#    整個 shell；置於 `then` 區塊內並不豁免：errexit 只對被**測試**的命令
#    （`if` 的條件）暫停，對它選中的區塊照常生效。
SIGN_FLAG=''                   # --sign → -S；--no-sign → --no-gpg-sign
# AI_CO_AUTHOR 必須在本 fence 內賦值，理由與 SIGN_FLAG／GIT_ENV 相同：未賦值不是
# 「預設 0」，而是由呼叫端決定——繼承的 AI_CO_AUTHOR=1 會在 `--ai-co-author` 未傳入時
# 選到白名單分支，而真的傳入時反而可能落到預設分支。旗標由 skill 決定，不由環境決定。
AI_CO_AUTHOR=0                 # 傳入 --ai-co-author 時，且僅在此時，由 skill 改為 1
if [ "$AI_CO_AUTHOR" = "1" ]; then
  if $GIT_ENV ALLOW_AI_COAUTHOR=1 /bin/bash -p "$GUARD" "$TMPFILE"; then
    if $GIT_ENV ALLOW_AI_COAUTHOR=1 git -C "$REPO_ROOT" commit $SIGN_FLAG -F "$TMPFILE"
    then COMMIT_STATUS=0; else COMMIT_STATUS=$?; fi
  else
    COMMIT_STATUS=1
    echo "❌ AI content detected after sanitization — aborting commit" >&2
  fi
else
  if $GIT_ENV /bin/bash -p "$GUARD" "$TMPFILE"; then
    if $GIT_ENV git -C "$REPO_ROOT" commit $SIGN_FLAG -F "$TMPFILE"
    then COMMIT_STATUS=0; else COMMIT_STATUS=$?; fi
  else
    COMMIT_STATUS=1
    echo "❌ AI content detected after sanitization — aborting commit" >&2
  fi
fi
rm -f "$TMPFILE" || echo "⚠️ 無法刪除 $TMPFILE，其中仍是完整 commit 訊息" >&2
[ "$COMMIT_STATUS" -eq 0 ] || exit 1
```

> 完整可執行版本是 `skills/smart-commit/scripts/smart-commit-execute.sh`（checked-in
> script）；`references/execute-mode.md` 只解釋它做什麼與為什麼，刻意不放程序副本（見該檔開
> 頭）。本節是設計說明，三者若分歧以 script 為實作契約，`execute-mode.md` 次之。
>
> 已知分歧（示意即止，script 為準）：上方草圖把 guard 的任何失敗都折疊成
> 「AI content detected」，這正是後來 PR review 抓到的缺陷——guard 的 exit
> contract 現在區分 1（內容裁定）與 3（環境失敗：檔案不存在、mktemp/grep 失敗），
> script 的 `cmd_commit` 把 1 映射為 status 4、其餘非零映射為 status 8
> （UNVERIFIED，環境問題，未產生 commit）；`verify_one` 則把非 1 的失敗併入既有的
> status 7。重複的白名單 trailer 也在 guard 端計數後拒絕（只准恰好一份）。

**`--ai-co-author` 窄白名單**:

啟用 `--ai-co-author` 時，僅允許以下精確格式：

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

其他 AI pattern（`Generated by`、`🤖`、其他 AI co-author 變體）仍然被 block。

**Post-commit 洩漏處理**（`--execute` 模式）:

```bash
# 每個 commit 後，用同一支 guard 掃描「實際被記錄下來的內容」。
# 這是**獨立的 shell**，所以 GIT_ENV 必須在此重新賦值：未賦值不是「預設為空」，
# 在繼承的 nounset 下會直接中止（且早於清理），沒有 nounset 則等於整段不套用剝除政策。
# `$GUARD` 同理，須以與上方完全相同的順序重新解析（此處省略，見 execute-mode.md）。
GIT_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR"
AI_CO_AUTHOR=0                 # 同上：分支選擇不得由繼承的環境決定
LOGFILE=$(mktemp "${TMPDIR:-/tmp}/smart-commit-log.XXXXXX") || exit 1
# 讀取失敗與寫入失敗都會留下空檔案，而空檔案對 guard 而言與乾淨訊息無異
# ——那會把一個從未被讀取的 commit 報成無洩漏。兩者都必須顯式拒絕。
if ! $GIT_ENV git log -1 --format='%B' > "$LOGFILE"; then
  echo "❌ 無法讀回 commit 訊息 — 該 commit 未經驗證，就此停止" >&2
  rm -f "$LOGFILE" || echo "⚠️ 無法刪除 $LOGFILE" >&2
  exit 1
fi
if [ ! -s "$LOGFILE" ]; then
  echo "❌ commit 訊息讀回為空 — 該 commit 未經驗證，就此停止" >&2
  rm -f "$LOGFILE" || echo "⚠️ 無法刪除 $LOGFILE" >&2
  exit 1
fi
# guard 的狀態以 if 捕捉後，清理，然後**在本區塊內重新拋出**：清理是最後一個命令，
# 成功的 rm 會讓整個區塊以 0 結束、把有洩漏的 run 報成乾淨，而下一個 fence 是另一個
# shell，$LEAK_STATUS 不會存活。狀態本身就是硬停止，amend 指引只是要印什麼。
# 分支必須與 commit 前的驗證一致：`--ai-co-author` 之下那一行**恰好是**被允許的內容，
# 無條件以 -u 清除等於把合法的白名單行報成 post-commit 洩漏。
if [ "$AI_CO_AUTHOR" = "1" ]; then
  if $GIT_ENV ALLOW_AI_COAUTHOR=1 /bin/bash -p "$GUARD" "$LOGFILE"; then
    LEAK_STATUS=0; else LEAK_STATUS=1; fi
else
  if $GIT_ENV /bin/bash -p "$GUARD" "$LOGFILE"; then
    LEAK_STATUS=0; else LEAK_STATUS=1; fi
fi
rm -f "$LOGFILE" || echo "⚠️ 無法刪除 $LOGFILE，其中仍是 commit 訊息" >&2
if [ "$LEAK_STATUS" -ne 0 ]; then
  echo "❌ commit 中出現 AI 署名洩漏，剩餘 commit groups 全數中止" >&2
  exit 1     # 立即停止所有剩餘 commit groups，輸出 amend 指引（不自動 amend）
fi
```

### 3.7 Regex 正規化

**現況問題**: `SKILL.md` 用 PCRE-style（`(?:...)`），`commit-msg-guard.sh` 用 BRE-style（`\(...\)`），產生方言不一致。

**統一為 ERE + `\b` 字界**（`grep -E`）:

| Pattern | 舊（混合） | 新（ERE + `\b` 字界, `grep -Ei`） |
|---------|-----------|----------------|
| Co-Authored-By AI | `Co-Authored-By:.*(?:Claude\|Anthropic\|...)` (PCRE) | `Co-Authored-By:.*(Claude\|Anthropic\|\bAI\b\|GPT\|OpenAI\|Copilot\|Codex\|Gemini\|noreply@anthropic)` |
| Generated-by tag | `Generated (?:by\|with).*(?:Claude\|...)` (PCRE) | `Generated[ -](by\|with).*(Claude\|Anthropic\|\bAI\b\|GPT\|OpenAI\|Copilot\|Codex\|Gemini)` |
| Emoji robot tag | `🤖.*\(Claude\|AI\|GPT\)` (BRE) | `🤖.*(Claude\|Anthropic\|\bAI\b\|GPT\|OpenAI\|Copilot\|Codex\|Gemini)` |

**注意**：ERE 中 `|` 和 `()` 不需要反斜線跳脫。上表「新」欄位中的 `\|` 為 Markdown 表格跳脫，實際 regex 為 `|`。所有 pattern 使用 `grep -Ei`（ERE + case-insensitive）。裸 `AI` 在 `-i` 下會誤中 "maintainer"、"domain" 等一般字詞，故僅對 `AI` 加 `\b` 字界（BSD 與 GNU grep 皆支援；POSIX `[[:<:]]` 不可攜）；`GPT`/`OpenAI` 刻意不加字界，以匹配 `ChatGPT`/`GPT-4`（無英文字含 "gpt"）。

**Canonical source**: `scripts/commit-msg-guard.sh` 為正規化後的唯一真實來源，SKILL.md 引用之。

### 3.8 Commit Plan 摘要（增強）

現有 commit plan 格式擴充：

```markdown
## Commit Plan

**Author**: Jane Doe <jane@company.com> (local config)
**Signing**: enabled (GPG, key: ABCD1234)
**AI guard**: active (commit-msg hook installed)

| # | Type | Files | Summary |
|---|------|-------|---------|
| 1 | fix  | 3     | Fix circuit breaker logic |
| 2 | test | 2     | Add RPC client unit tests |
```

## 4. Risks and Dependencies

| Risk | 影響 | 緩解策略 |
|------|------|---------|
| `--show-scope` 在舊版 Git (<2.26) 不支援，`--show-origin --get-all` 需 ≥2.8 | 診斷失敗 | **round 18 訂正**：本行原記載「偵測 git 版本，fallback 到 `--get`」，這個版本探測從未實作。實際行為是失敗封閉——`emit_config_records`（`smart-commit-inspect.sh`）讀取 rc≠0/≠1 一律視為「無法讀取」而中止（`could not read <key> — aborting`），而非靜默降級成較弱的旗標。measured：舊版 git 對 `--show-scope` 回傳非 0，`rev-parse` 本身仍成功，證明中止來自這次讀取本身。Oracle：`P8f`（`4-implementation.md` §10.1） |
| `includeIf` 解析複雜 | 誤判衝突 | 衝突定義 = 解析值不同，而非來源數不同 |
| Runtime validation temp file race condition | 訊息被修改 | `mktemp`（原子建立、名稱不可預測、0600）+ validation 與 `git commit -F` 置於**同一個 bash 區塊**。殘留：guard 與 git 仍各自開檔一次，同使用者行程可在其間換掉內容；post-commit 掃描是它的偵測層。**不得**改用固定路徑（曾短暫改為 `/tmp/smart-commit-msg-1.txt`，引入 symlink 覆寫、同名碰撞與洩漏） |
| `gpg.format=ssh` signing key format 不同 | Key 存在性檢查邏輯不同 | 根據 `gpg.format` 調整 key 驗證邏輯 |
| Headless/CI 環境無法互動 | AskUserQuestion 阻塞 | 偵測 `CI` 環境變數，跳過互動提示 |
| ERE regex 在 macOS/Linux `grep` 行為差異 | 跨平台不一致 | **未緩解**：測試只跑執行主機上的那一份 grep（本 repo 為 BSD grep）。CI 若在 Linux 執行同一套測試即構成另一半覆蓋；在此之前這是已知缺口，不是已完成的驗證 |

## 5. Work Breakdown

| # | Task | 預估 | 依賴 |
|---|------|------|------|
| W1 | 修改 SKILL.md：新增 Step 1c Identity Diagnostics | S | — |
| W2 | 修改 SKILL.md：新增 Step 1d Signing Diagnostics | S | — |
| W3 | 修改 SKILL.md：新增 Step 1e AI Guard Readiness | S | — |
| W4 | 修改 SKILL.md：Step 5c Runtime Validation（temp-file + grep -E） | M | W3 |
| W5 | 修改 SKILL.md：Step 5b `--ai-co-author` 窄白名單 | S | W4 |
| W6 | 修改 SKILL.md：Post-commit 洩漏 hard stop | S | W4 |
| W7 | 修改 SKILL.md：Commit plan 摘要增強 | S | W1, W2, W3 |
| W8 | 正規化 `commit-msg-guard.sh` regex 為 ERE + `\b` 字界 | S | — |
| ~~W9~~ | ~~修改 `commands/smart-commit.md` context block~~ — v3.0.0 已移除 `commands/`，不再適用 | — | — |
| W10 | 新增 `--sign` / `--no-sign` flags | S | W2 |
| W11 | 新增 `test/scripts/smart-commit.test.js` | M | W1–W10 |
| W12 | 更新 CLAUDE.md Command Quick Reference | S | W10 |
| W13 | 把 §3.6 的 inline validate + commit 抽成 `smart-commit-execute.sh`（`alloc` / `commit` / `verify-last`） | L | W6 |
| W14 | 把 §3.2–3.4 的 inline 診斷 fence 抽成 `smart-commit-inspect.sh`（十個 subcommand）+ `test/scripts/smart-commit-inspect.test.js`。**本項「減重」的目標達成與否，量測見 [4-implementation.md § 11](./4-implementation.md)** | L | W13 |

**Size**: S = ≤30 min, M = 30–60 min

## 6. Testing Strategy

### 6.1 Unit Tests（`test/scripts/smart-commit.test.js`、`test/scripts/smart-commit-inspect.test.js`）

前者測 SKILL.md 這個指令面（fence 形狀、locator、前綴政策、frontmatter 授權），後者測抽出來的診斷腳本本身（環境剝離、root 錨定、pathspec magic、arity、退出狀態）。W13/W14 之後兩者都是必要的：只測其一，另一半的迴歸不會被看見。

| Test Case | 驗證目標 |
|-----------|---------|
| Identity: 正常解析（single source） | 靜默通過，commit plan 含 identity |
| Identity: 缺失 user.name | HALT 輸出 + setup 指引 |
| Identity: 多來源但值相同 | 視為正常（不誤判） |
| Identity: 衝突（不同值） | 觸發 AskUserQuestion |
| Identity: env var 覆寫 | 顯示 warning |
| AI guard: forbidden pattern 偵測 | `Co-Authored-By: Claude` → 被攔截 |
| AI guard: 合法 human Co-Authored-By | `Co-Authored-By: Jane <jane@co.com>` → 通過 |
| AI guard: `--ai-co-author` 白名單 | 僅精確格式通過 |
| AI guard: 其他 AI pattern + `--ai-co-author` | `Generated by Claude` → 仍被 block |
| Signing: enabled + key present | 顯示 enabled 狀態 |
| Signing: enabled + key missing | 顯示 warning |
| Signing: not configured | 顯示 inherit 狀態 |
| Regex: ERE + `\b` 字界（**單一主機**） | 只驗證執行主機的 grep；GNU／BSD 兩者皆驗尚未達成（見 §4） |
| Hook detection: `core.hooksPath` awareness | 非標準 hook 路徑正確偵測 |

### 6.2 Integration Tests（`test/scripts/smart-commit-execute.test.js`、`test/scripts/smart-commit-scope.test.js`）

**round 18 review 訂正**：本節曾記載「`--execute` 行為流程沒有任何測試實際跑完，需要一個真實 repo
與使用者核准，屬 `/feature-verify` 的範圍」——這句話與 `execute-mode.md` 自身的說法（`test/scripts/
smart-commit-execute.test.js` 在拋棄式 repo 中驅動真實 commit）矛盾，且並不成立：該檔案的測試正是
在拋棄式的真實 repo 中實際執行 commit，斷言 exit status、HEAD 是否移動、訊息檔是否還留在磁碟上。
行數與測試數不記在這裡——這兩個數字在本節先前的版本就已經因為檔案持續編輯而過期，記一次過期一次，
本節下一句自己給的理由（改以測試名稱而非會過期的數字引用）同樣適用於這裡。`execute-mode.md` 的結構性宣稱（validator 不由環境變數選定、訊息檔以 `mktemp` 配置、
預設分支清除 `ALLOW_AI_COAUTHOR`、frontmatter 已預先授權所需工具）與下表都由它涵蓋。

引用方式與 `4-implementation.md` § 7 相同的理由：以測試名稱而非 `:NN` 行號引用——round 21 在此檔案
中段插入一個測試，下表原本記載的四個行號當場全部失準，測試名稱本身用 `grep` 即可定位，不會過期。

| Test Case | 驗證目標 | 狀態 |
|-----------|---------|------|
| `--execute` 模式 temp-file validation 攔截 AI 內容 | `commit with an AI trailer and no opt-in` → exit 4、HEAD 不動、訊息檔被移除 | ✅ 已測試 |
| commit-msg hook 注入 attribution 才被攔截，不誤判乾淨 | `a commit-msg hook injecting attribution is caught, not reported clean` | ✅ 已測試 |
| Post-commit AI 洩漏偵測 → hard stop | `a post-commit hook stacking a clean commit cannot hide the leaking one` | ✅ 已測試 |
| `--execute` 模式簽名失敗 | 立即停止 + 修復指引 | ⛔ 未實作 —— `--sign`/`--no-sign` 的 argv 本身已 pin（`--no-sign reaches git as --no-gpg-sign`、`--sign reaches git as -S`），但沒有測試驅動「簽名失敗」這條路徑本身（例如 `commit.gpgsign=true` 搭配壞掉的簽名金鑰，讓 `git commit` 真的失敗） |

唯一存活的缺口是簽名失敗路徑，留待下一輪或 `/feature-verify`。

## 7. Open Questions

| # | 問題 | 建議 | 決策狀態 |
|---|------|------|---------|
| Q1 | CI/headless 環境 identity 衝突如何處理？ | **Fail-closed**：衝突時 HALT + 輸出修復指引，不靜默繼承錯誤 identity | ✅ 已確認 |
| Q2 | Git 版本最低要求？ | **round 18 訂正**：`includeIf` 確實只需 ≥2.13，但這不是實際地板——`--show-scope`（`emit_config_records` 每次都用）需 ≥2.26，而 SKILL.md:228-230、§10.8 依賴的 `author.*`/`committer.*` 優先序需 ≥2.31。建議 Git ≥ 2.31 | ✅ 已確認 |
| Q3 | `commit-msg-guard.sh` 是否改為 ERE 後仍向下相容？ | `grep -E` 在所有目標平台可用（需測試驗證） | 待測試驗證 |
| Q4 | 是否需要 `--profile <name>` flag 顯式選擇 profile？ | Phase 2 考慮，Phase 1 先用 diagnostics + AskUserQuestion | 延後 |

## 8. Deviations

本節記錄「已知偏離規則、已聲明、不需回答」的項目——與 §7 不同，這裡沒有待決問題。

| # | 偏離的規則 | 處置與理由 | 定性 |
|---|-----------|-----------|------|
| D1 | 本檔已越過 `@rules/docs-numbering.md` 的 500 行門檻。**重新以 `wc -l` 量得：round 24 re-review 後仍為 527 行**（與 round 24 doc sync 當時記的數字相同——這次的 D1/D2 編輯只改表格儲存格內的文字，沒有新增或刪除行，所以本檔自身的行數這一輪沒有 drift；上一輪的過期教訓仍然適用，只是這輪剛好沒踩到）。**本次變更（round 24 re-review doc sync，承接 §10.17/§10.18 的原始碼與測試修訂）只編輯 D1/D2 兩列本身，不動其他章節** | **拆檔**：§3 佔 **399 行**（lines 35–433，佔全檔 **75.7%**，以本輪量得的 527 行為分母）且有乾淨的 3.1–3.8 邊界（用會辨識 ```markdown 圍籬的掃描確認——`:422` 的 `## Commit Plan` 在 §3.8 圍籬內，是示範輸出，不是節界）。全檔真正的 `##` 起始行為 3 / 10 / 35 / 434 / 445 / 466 / 511 / 520。目標結構 `2-tech-spec/2-tech-spec.md` + 子檔。**不在本次變更做**——會動到 `test/scripts/smart-commit.test.js` 四處硬編路徑（`SUPERSEDED_SPEC:327`、`hardeningSpec:366`、F1d sweep `:373`、`:310` 的同路徑註解）與 `create-pr-stacked/2-tech-spec.md:178` 及其 review log，屬獨立變更。**明確不採用**「壓縮內容鑽過 500」，規則本身禁止 | **延後，非豁免**。規則給的免拆理由是「這份整著讀比較好」；本列主張的是相反的（該拆，但成本落在別的變更）。超出量：本次變更前 **27 行**（527−500）。round 15/16 之前記的更小數字都是本檔更小時算的，已無參考價值，不再逐一列出 |
| D2 | `4-implementation.md` 同樣越過 500 行門檻。round 24 re-review（新增 § 10.17；隨後第二輪 fallback re-review 又發現 § 10.17 自己新增的哨符防護有 P0 級繞過，新增 § 10.18 記錄該輪發現與修法；同時重新量測 §11 的量測列與其衍生百分比）後，以 `wc -l` 量得：**1750 行**（§10.17 剛寫完、§10.18 尚未新增時為 1691 行；round 24 review 剛收斂、§10.16 寫完時為 1631 行；round 24 初次寫完 §10.16 時為 1624 行） | **拆檔，但不在本次變更做**。最大的 §10 佔 **1183 行（67.6%）**（lines 459–1641，用 `## 11.` 的起始行 1642 反推），現有 10.1–10.18 **十八個** `###` 邊界（新增的 § 10.18 是第二輪 fallback re-review 的產物），正是規則說的「自然的子文件」形狀，且比例逐輪升高，免拆論證已經站不住，照實記在這裡。改為延後的理由只剩一條：拆檔會改動所有指向本檔的引用，而本次變更的 review loop 尚未收斂，在收斂前搬動檔案會讓每一輪的行號引用全部失效。成本：指向本檔的引用仍是 **32 行**，散在 6 個檔案（`SKILL.md` 4、`git-environment.md` 8、`smart-commit-inspect.sh` 11、**`2-tech-spec.md`（本檔）6**、兩支測試 3），其中一行就是本列自己——§ 10.17、§ 10.18 兩段與這兩輪擴充的兩支測試檔（`smart-commit-execute.test.js`、`smart-commit-inspect.test.js`）都沒有新增指向本檔的引用，所以總數自 round 24 doc sync 以來沒再動過。**`4-implementation.md` 對自己沒有引用（0 行）**。推導（表格內的管線符號以 `\|` 跳脫，一道指令涵蓋所有寫法，含只寫檔名不寫路徑的那些）：`grep -rn '4-implementation\.md' skills/smart-commit/ test/scripts/smart-commit-inspect.test.js test/scripts/smart-commit.test.js docs/features/smart-commit-hardening/2-tech-spec.md \| wc -l` → 32（round 23 時為 31；round 24 doc sync 時新增到 32；此後兩輪 re-review 皆未再新增）。**退出條件（round 18 review 新增，此前這條延後沒有終點）**：review loop 一旦收斂（連續兩輪皆 `✅ Ready`/`✅ Mergeable` 且無新增 finding），拆檔排在下一次觸碰本檔的變更之前執行，不得再無限期延後——本列自己就是「延後」被拿來墊檔九輪的證據 | **延後，非豁免**。本檔不屬 `@rules/docs-numbering.md` 的功能性文件豁免（它是 `docs/**` 散文），所以這是一條 `[DEVIATION]` 而非「不適用」。免拆的理由只有一條，且明說其限度：這份文件不是從頭讀到尾的，而是被 `§ N` 指標跳進來的，長度的代價落在捲動的讀者身上。更早幾輪的成本數字曾算錯兩次——兩道指令各自漏算了對方涵蓋的寫法；現行數字改用單一 `grep -rn ... \| wc -l` 指令，兩種寫法一起涵蓋，不再重蹈 |
