# Load PR Review — Technical Spec

## 1. Requirement Summary

- **Problem**: 開發者收到 PR review feedback 後，必須在 GitHub 網頁和 Claude Code terminal 之間反覆切換才能理解、討論、修復建議。現有 skills 無任何「載入 PR review comments」能力。
- **Goals**: 建立 `/load-pr-review` skill，將 GitHub PR review 建議載入當前 AI session，支援討論、修復、回寫的完整閉環。
- **Scope**: 新 skill（SKILL.md + 1 JS script + references + command）

## 2. Existing Code Analysis

### Related Modules

| Module | 可復用部分 |
| ------ | ---------- |
| `skills/create-pr/` | branch→PR 自動映射、`gh pr list --head` pattern |
| `skills/pr-summary/` | Script runner pattern (`scripts/run-skill.sh`)、jq 處理 |
| `skills/push-ci/` | AskUserQuestion gate pattern、CI monitoring |
| `skills/smart-commit/` | `--execute` dry-run/execute 雙模式 |
| `commands/*.md` | `!` Context block 自動收集 branch/repo |

### Reusable Components

| Component | Source | Reuse |
| --------- | ------ | ----- |
| PR auto-detect | `gh pr view --json number` (no arg = current branch) | 直接複用 |
| AskUserQuestion gate | `push-ci`, `smart-commit` | 回寫確認 |
| Script runner | `scripts/run-skill.sh` | JS script 執行 |
| auto-loop handoff | `rules/auto-loop.md` | fix 模式後 review+precommit |

### Files Requiring Changes

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/load-pr-review/SKILL.md` | New | 主 skill 定義 |
| `skills/load-pr-review/scripts/load-pr-review.js` | New | Data plane（fetch/normalize/digest/writeback） |
| `skills/load-pr-review/references/api-contract.md` | New | GraphQL query + REST fallback 規格 |
| `skills/load-pr-review/references/token-budget.md` | New | 截斷策略 + budget |
| `skills/load-pr-review/references/writeback-guardrails.md` | New | 回寫安全規則 |
| `commands/load-pr-review.md` | New | Command 定義 + context block |
| `CLAUDE.md` | Modify | 新增 `/load-pr-review` 到 Command Quick Reference |

## 3. Technical Solution

### 3.1 Architecture Design

```mermaid
sequenceDiagram
    participant U as User
    participant Cmd as commands/load-pr-review.md
    participant SK as SKILL.md (Orchestration)
    participant JS as load-pr-review.js (Data Plane)
    participant GH as GitHub (gh CLI)
    participant AL as Auto-Loop

    U->>Cmd: /load-pr-review [args]
    Cmd->>SK: Context (branch, repo, args)
    SK->>SK: Step 0: Resolve PR target

    SK->>JS: fetch --pr <N> --repo <owner/repo>
    JS->>GH: gh pr view --json (metadata)
    JS->>GH: gh api graphql (reviewThreads)
    JS-->>SK: Normalized JSON (threads + comments)

    SK->>JS: digest --budget 30
    JS-->>SK: Token-budgeted summary

    SK->>U: Present digest (summary mode)

    alt --mode plan
        SK->>U: Classify + suggest fix strategy
    end

    alt --mode fix
        U->>SK: Select threads to fix
        loop Each thread
            SK->>SK: Read file + apply fix
            SK->>AL: auto-loop (code→review-fast; doc→review-doc)
        end
    end

    alt --writeback
        SK->>JS: writeback --plan
        JS-->>SK: Dry-run plan
        SK->>U: Show plan (AskUserQuestion)
        U->>SK: Approve
        SK->>JS: writeback --execute --threads <IDs>
        JS->>GH: REST reply + GraphQL resolve
    end
```

### 3.2 Data Model

#### GraphQL Query（primary — `reviewThreads`）

```graphql
query ($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      title
      number
      url
      headRefName
      baseRefName
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          diffSide
          comments(first: 20) {
            nodes {
              id
              databaseId
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}
```

#### Normalized Thread Model（JS script output）

```json
{
  "pr": { "number": 42, "title": "...", "url": "...", "head": "feat/x", "base": "main" },
  "summary": { "total": 15, "unresolved": 8, "outdated": 3, "loaded": 8, "truncated": 0 },
  "threads": [
    {
      "id": "PRRT_...",
      "path": "src/service/foo.ts",
      "line": 42,
      "isResolved": false,
      "isOutdated": false,
      "category": "code_change",
      "replyTargetId": 12345,
      "comments": [
        {
          "id": "PRRC_...",
          "databaseId": 12345,
          "author": "reviewer",
          "body": "This should use early return pattern",
          "createdAt": "2026-03-04T10:00:00Z"
        }
      ]
    }
  ]
}
```

#### Comment Classification

| Category | 判斷方式 | Action |
| -------- | -------- | ------ |
| `code_change` | 涉及程式碼修改建議 | Fix in editor |
| `doc_update` | 涉及文件/註解修改 | Update docs |
| `question` | 疑問句、需要解釋 | Reply with explanation |
| `disagree` | 反對意見、設計決策分歧 | AskUserQuestion — 使用者決定 |
| `nit` | 風格/命名等微小建議 | Optional fix |

### 3.3 API Design

#### Script Subcommands

```bash
# Fetch + normalize
bash scripts/run-skill.sh load-pr-review load-pr-review.js \
  fetch --pr 42 --repo owner/repo

# Token-budgeted digest
bash scripts/run-skill.sh load-pr-review load-pr-review.js \
  digest --budget 30 --input /tmp/load-pr-review-raw.json

# Writeback plan (dry-run)
bash scripts/run-skill.sh load-pr-review load-pr-review.js \
  writeback --plan --threads PRRT_a,PRRT_b --input /tmp/load-pr-review-raw.json

# Writeback execute
bash scripts/run-skill.sh load-pr-review load-pr-review.js \
  writeback --execute --threads PRRT_a --reply "Fixed in abc123" --repo owner/repo --pr 42
```

#### User-Facing Arguments

| Argument | Description | Default |
| -------- | ----------- | ------- |
| `<PR#\|URL>` | PR 指定 | 當前分支的 PR |
| `--mode <summary\|plan\|fix>` | 互動模式 | `summary` |
| `--all` | 顯示全部 comments（含已解決，硬上限 200） | `false` |
| `--writeback` | 啟用回寫功能 | `false` |
| `--execute` | 回寫直接執行（跳過 dry-run） | `false` |
| `--budget <N>` | Max loaded comments | `30` |

### 3.4 Core Logic

#### Step 0: PR Target Resolution

```
1. 明確指定 PR# → 直接使用
2. 指定 URL → 解析 owner/repo/number
3. 無參數 → gh pr view --json number,title (current branch auto-detect)
4. 都找不到 → AskUserQuestion 請使用者輸入
```

#### Step 1: Fetch Metadata

```bash
gh pr view <N> --json number,title,url,headRefName,baseRefName,state,reviewDecision
```

Preflight checks:

| Check | Fail Action |
| ----- | ----------- |
| PR exists | Abort: "PR not found" |
| PR is open | Warn: "PR is closed/merged, showing historical reviews" |

> Note: "Has review threads" 檢查在 Step 2 fetch 完成後執行（metadata 不含 thread 資訊）。若無 threads → Inform: "No review comments on this PR"。

#### Step 2: Fetch Review Threads（GraphQL）

```bash
gh api graphql -f query='...' -F owner='{owner}' -F repo='{repo}' -F pr={number}
```

Pagination: GraphQL `first: 100` covers most PRs. Query 已包含 `pageInfo { hasNextPage endCursor }` 與 `$cursor` 變數。v1 硬上限 100 threads（超出顯示警告 `⚠️ 100+ threads detected, showing first 100`），v2 再實作 cursor 自動分頁。

Fallback: If GraphQL fails（auth/permission），降級到 REST:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
```

顯示 banner: `⚠️ REST fallback: thread resolution status unknown`

#### Step 3: Normalize + Filter

| Filter | Default | `--all` |
| ------ | ------- | ------- |
| Unresolved only | ✅ | ❌ |
| Exclude outdated | ✅ | ❌ |
| Token budget | 30 comments | 200 comments（硬上限，防止 context 爆量） |

#### Step 4: Present Digest（依 mode）

**summary mode**（default）:

```markdown
## PR #42: Feature title
**Review Status**: 8 unresolved / 15 total threads (3 outdated excluded)

| # | File | Line | Reviewer | Category | Comment (truncated) |
|---|------|------|----------|----------|---------------------|
| 1 | src/foo.ts | 42 | alice | code_change | Use early return... |
| 2 | src/bar.ts | 15 | bob | question | Why was this... |

💡 Use `--mode plan` to get fix strategy, or `--mode fix` to start fixing.
```

**plan mode**:

```markdown
## Fix Strategy

### Priority 1: Code Changes (5 threads)
| # | File | Reviewer | Summary | Estimated Effort |
|---|------|----------|---------|-----------------|

### Priority 2: Questions (2 threads)
| # | File | Reviewer | Question |
|---|------|----------|----------|

### Priority 3: Nits (1 thread)
...

### Needs Discussion (0 threads)
(disagree items — require user decision)
```

**fix mode**:

1. Present plan → AskUserQuestion: 選擇要修復的 threads
2. For each selected thread:
   - Read file context around `path:line`
   - Apply fix
   - **Auto-loop**（依變更類型）: code → `/codex-review-fast` → `/precommit`; doc → `/codex-review-doc`
3. After all fixes: suggest `--writeback` to close the loop

#### Step 5: Writeback（optional）

**Dry-run** (`--writeback`):

```markdown
## Writeback Plan

| # | Thread | Action | Reply Content |
|---|--------|--------|---------------|
| 1 | PRRT_a | Reply + Resolve | "Fixed: switched to early return pattern (abc123)" |
| 2 | PRRT_b | Reply only | "This is by design because..." |

⚠️ Execute with --writeback --execute to apply
```

**Execute** (`--writeback --execute`): AskUserQuestion gate → 逐條執行:

```bash
# Reply（使用 jq + --input 傳遞 body，避免 shell escaping + malformed JSON）
jq -n --arg body "$REPLY" '{body:$body}' | \
  gh api --method POST repos/{owner}/{repo}/pulls/{pr}/comments/{replyTargetId}/replies --input -

# Resolve thread
gh api graphql -f query='mutation($id:ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' -F id='PRRT_a'
```

**Writeback 安全規則**:
- Reply 目標必須使用 `replyTargetId`（thread 首條 comment 的 `databaseId`），非任意 comment
- Body 內容透過 JSON `--input -` 傳遞，避免 shell injection
- 若 `replyTargetId` 缺失，降級為僅輸出 plan，不執行 resolve

## 4. Risks and Dependencies

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| GraphQL query fails（auth/permission） | 無法取得 `isResolved` | REST fallback + degraded banner |
| 大 PR 100+ comments token 爆量 | Context window 溢出 | Token budget（default 30）+ 截斷 metadata |
| 自動 resolve 不符 reviewer 期望 | 社交問題、信任損失 | Dry-run default + AskUserQuestion + 逐條確認 |
| Thread 在 force-push 後 outdated | 行號對不上 | `isOutdated` filter + warn |
| auto-loop 在 fix mode 中中斷 | 修復未完成 | fix 逐條進行，每條獨立 loop |
| 專案無 GraphQL 慣例 | 團隊不熟悉 | 封裝在 JS script 中，使用者不直接接觸 |

## 5. Work Breakdown

| # | Task | Effort | Dependency |
|---|------|--------|------------|
| 1 | `references/api-contract.md` — GraphQL query + REST fallback | S | — |
| 2 | `references/token-budget.md` — 截斷策略 | S | — |
| 3 | `references/writeback-guardrails.md` — 回寫安全規則 | S | — |
| 4 | `scripts/load-pr-review.js` — Data plane script | L | #1 |
| 5 | `SKILL.md` — Orchestration workflow | M | #1, #2, #3 |
| 6 | `commands/load-pr-review.md` — Command definition | S | #5 |
| 7 | `test/scripts/load-pr-review.test.js` — Unit tests | M | #4 |
| 8 | CLAUDE.md — Add to command reference | S | #6 |
| 9 | Verification: `/skill-health-check` + `/codex-review-doc` | S | #5, #6 |

**Total estimated effort**: M-L（1 JS script ~200-300 LOC + 3 reference docs + SKILL.md）

## 6. Testing Strategy

| Type | Target | Mock |
| ---- | ------ | ---- |
| Unit | `load-pr-review.js` subcommands | ✅ Mock `gh` CLI output |
| Unit | PR target resolution cascade | ✅ Mock `gh pr view` |
| Unit | Token budget truncation | ✅ In-memory |
| Unit | Comment classification | ✅ In-memory |
| Integration | Full fetch → digest pipeline | ⚠️ Mock `gh api graphql` response |
| Manual | Real PR with review comments | ❌ Real `gh` CLI |

**Test file**: `test/scripts/load-pr-review.test.js`

**Coverage targets**:
- PR resolution: explicit / URL / current branch / no PR
- GraphQL fetch: success / fail (REST fallback)
- Filter: unresolved only / all / outdated exclusion
- Budget: within limit / truncation / zero comments
- Writeback: dry-run / execute / partial (selected threads)

## 7. Open Questions

| # | Question | Impact | Suggested Resolution |
|---|----------|--------|---------------------|
| 1 | GraphQL pagination cursor 是否需要支援 100+ threads？ | 極少 PR 超過 100 threads | v1 用 `first: 100`，v2 加 cursor |
| 2 | `disagree` 類型的 comment 是否需要特殊 UI？ | 使用者決策點 | AskUserQuestion with options |
| 3 | fix mode 中 auto-loop 失敗（precommit fail）怎麼辦？ | 修復中斷 | 遵循 auto-loop rule（fix → re-run） |
| 4 | 是否需要支援 cross-repo PR（fork 的 PR）？ | Fork-based workflow | v1 不支援，`--repo` flag 預留 |
| 5 | Skill name: `load-pr-review` vs `pr-feedback` vs `address-review`？ | 命名一致性 | 待使用者確認 |

## 8. Known Issues

### 8.1 Context Check Permission Parser vs jq `()` Syntax

**Root Cause**: Claude Code permission parser 將 `!` context check 中的 `()` 字元解釋為 shell subshell，觸發 approval prompt。jq 大量使用 `()`（如 `\(.number)`、`(.number|tostring)`）。

**Failed Attempts**:

| # | Approach | Problem |
|---|----------|---------|
| 1 | `--jq '"#\(.number)..."'` | Parser strips `\`, sees `()` |
| 2 | `--jq '"#"+(.number\|tostring)+"..."'` | Parser sees `()` around `.number\|tostring` |
| 3 | `bash -c '... \| jq ...'` | "This command requires approval" |

**Solution**: Go templates (`gh --template`) — decided via Codex Brainstorm session `019cbbcd`

| Criterion | jq | Go Template |
|-----------|----|----|
| `()` 字元 | 必須 | 無 |
| Permission parser | 失敗 | 通過 |
| 專案 precedent | 4 個 `--jq` | 0（首例） |
| 輸出格式控制 | 完整 | 完整 |

```bash
gh pr view --json number,title,state --template '#{{.number}} {{.title}} [{{.state}}]'
```
