# Fix Hook State Persistence for MCP/Skill Tool Calls

| Field | Value |
|-------|-------|
| Status | **Completed** |
| Priority | P1 |
| Created | 2026-02-12 |
| Updated | 2026-02-12 |
| Feature | review-state-tracking |
| Tech Spec | TBD |

## Background

PostToolUse hook (`post-tool-review-state.sh`) originally only matched `Bash` tool calls. Review commands (`/codex-review-fast`, `/codex-review-doc`) execute via `mcp__codex__codex` / `mcp__codex__codex-reply` MCP tools, so their gate sentinels were never captured. Note: `/precommit` runs via Bash (`node scripts/precommit-runner.js`) and was already captured — only MCP-based reviews were affected. This caused `.claude_review_state.json` to never update `code_review` / `doc_review` pass status, making `stop-guard.sh` and `analyze.js` read stale state. Additionally, `post-edit-format.sh` set `has_*_change` flags but never invalidated `passed` flags when files were edited after a review, creating another stale-state vector.

After implementation, MCP precommit sentinel handling (`## Overall: ✅ PASS` / `⛔ FAIL`) was also added to the MCP routing path to ensure completeness, even though Bash-based precommit detection was already working.

## Requirements

- PostToolUse hook must trigger on MCP tool outputs (`mcp__codex__codex`, `mcp__codex__codex-reply`) to capture gate sentinels from code/doc reviews
- MCP command routing: determine which state key (`code_review` or `doc_review`) to update based on sentinel vocabulary (see Sentinel Routing table)
- Edit-time invalidation: editing code/doc files must reset corresponding `passed` flags (preserve `executed` and `last_run`)
- Stop-guard must cross-check `has_*_change` flags against actual `git status` to detect stale state; fail-open if `git` is unavailable
- Backward compatible: existing Bash-based sentinel detection must continue working

## Sentinel Routing

MCP output contains gate sentinels that indicate review type and result. Routing uses **specific-first precedence**: scan for doc-specific tokens first, then code-specific, then generic fallback.

**Precedence order** (first match wins):

| Priority | Sentinel Pattern | State Key | Passed |
|----------|-----------------|-----------|--------|
| 1 (doc-specific) | `✅ Mergeable` | `doc_review` | `true` |
| 1 (doc-specific) | `⛔ Needs revision` | `doc_review` | `false` |
| 2 (code-specific) | `✅ Ready` | `code_review` | `true` |
| 2 (code-specific) | `⛔ Blocked` | `code_review` | `false` |
| 3 (precommit) | `## Overall: ✅ PASS` | `precommit` | `true` |
| 4 (generic) | `✅ All Pass` | `code_review` | `true` |
| 5 (ambiguous) | `## Gate: ✅` / `## Gate: ⛔` alone | Skip (no update) | — |

**Ambiguity rule**: Bare `## Gate: ✅` / `## Gate: ⛔` without a co-occurring specific token (`Ready`/`Blocked`/`Mergeable`/`Needs revision`) is ambiguous — do not update state. This prevents misrouting when both code and doc review contracts share the generic sentinel.

Extraction source: `.tool_output.content[]` text entries (MCP returns content as array of `{type, text}` objects).

## Scope

| Scope | Description |
|-------|-------------|
| In | Hook matcher expansion, MCP output parsing with sentinel routing, edit invalidation, stale-state git check |
| Out | Changing file-based persistence to alternative mechanism, modifying analyze.js, changing sentinel format |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/hooks.json` | Modify | Add MCP tool matchers to PostToolUse |
| `hooks/post-tool-review-state.sh` | Modify | Support MCP payload format, sentinel-based routing to `code_review` / `doc_review` |
| `hooks/post-edit-format.sh` | Modify | Invalidate `code_review.passed` / `precommit.passed` on code edit, `doc_review.passed` on doc edit |
| `hooks/stop-guard.sh` | Modify | Add `git status` cross-check for stale `has_*_change` flags, fail-open if git unavailable |
| `test/hooks/post-tool-review-state.test.js` | Modify | Add MCP trigger + sentinel routing test cases |
| `test/hooks/post-edit-format.test.js` | Modify | Add edit-invalidation + preservation test cases |
| `test/hooks/stop-guard.test.js` | Modify | Add stale-state override + git unavailable test cases |
| `commands/install-hooks.md` | Modify | Update documented matcher values to reflect MCP expansion |

## Acceptance Criteria

### Fix 1: MCP Tool Matcher + Sentinel Routing

- [x] `hooks/hooks.json` PostToolUse has matcher `Bash|mcp__codex__codex|mcp__codex__codex-reply` for review-state hook
- [x] `post-tool-review-state.sh` detects MCP tool name and extracts output from `.tool_output.content[]` text entries
- [x] Sentinel routing uses specific-first precedence: doc-specific (`Mergeable`/`Needs revision`) > code-specific (`Ready`/`Blocked`) > generic
- [x] Full sentinel set parsed: `✅ Ready`, `✅ Mergeable`, `✅ All Pass`, `⛔ Blocked`, `⛔ Needs revision`, `## Overall: ✅ PASS`, `## Overall: ⛔ FAIL`
- [x] Bare `## Gate: ✅` / `## Gate: ⛔` without co-occurring specific token skips state update (ambiguity rule)
- [x] Existing Bash-based detection still works (backward compatible)

### Fix 2: Edit-Time Invalidation

- [x] `post-edit-format.sh` resets `code_review.passed = false` and `precommit.passed = false` when a code file is edited
- [x] `post-edit-format.sh` resets `doc_review.passed = false` when a doc file is edited
- [x] Only resets `passed` flags, preserves `executed` and `last_run` values

### Fix 3: Stale-State Git Check

- [x] `stop-guard.sh` runs `git status --porcelain -uall` when using state file mode
- [x] If git shows no modified code files but `has_code_change = true`, overrides to `false`
- [x] If git shows no modified doc files but `has_doc_change = true`, overrides to `false`
- [x] Fail-open: if `git` is unavailable or not in a repo, skip stale-state check (trust state file)

### Testing

- [x] Test: MCP tool name triggers state update (not just Bash)
- [x] Test: `✅ Ready` sentinel routes to `code_review.passed = true`
- [x] Test: `✅ Mergeable` sentinel routes to `doc_review.passed = true`
- [x] Test: Gate sentinel extracted from MCP content array format
- [x] Test: Editing `.js` file after review pass resets `code_review.passed`
- [x] Test: Edit invalidation preserves `executed` and `last_run`
- [x] Test: Editing `.md` file after doc review pass resets `doc_review.passed`
- [x] Test: Clean worktree overrides stale `has_code_change`
- [x] Test: Clean worktree overrides stale `has_doc_change`
- [x] Test: Git unavailable fails open (state file trusted)
- [x] Test: Ambiguous `## Gate: ✅` alone (no specific token) does not update state
- [x] All existing hook tests pass (backward compatibility)

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | `/codex-brainstorm` Nash Equilibrium reached |
| Development | Done | All 8 deliverables implemented, `/codex-review-fast` ✅ Ready |
| Testing | Done | 132 tests pass (74 hook + 58 script), `/precommit` ✅ PASS |
| Acceptance | Done | 25/25 AC items verified |

## Additional Fixes (from brainstorm + review)

Beyond the original plan, the following issues were discovered and fixed during implementation:

| ID | Priority | Issue | Fix |
|----|----------|-------|-----|
| A2 | P1 | MCP precommit FAIL handler missing | Added `## Overall: ⛔ FAIL` handler |
| B2 | P1 | Quoted/unicode filenames bypass porcelain regex | Strip quotes with sed before matching |
| P1-3 | P1 | Rename entries bypass extension regex | Changed `$` to `($\|\s\|")` boundary |
| jq-guard | P1 | jq crashes on plain-string `tool_output` | Added outer type guard in jq expression |
| sec-collision | P1 | `✅ Mergeable` collision with `/codex-security` | Added `Mergeable: No P0` exclusion |

## Known P2 Issues (deferred)

See: [Sentinel Hardening Request](./2026-02-12-sentinel-hardening-p2.md)

## References

- Brainstorm conclusion: File persistence kept, 3 fixes identified (MCP matcher + edit invalidation + git check)
- Brainstorm followup: 2 P1 + 5 P2 hidden issues found, P1 fixed, P2 deferred
- Related feature: [Plugin Testing & Generalization](../../plugin-testing-generalization/requests/2026-02-01-plugin-testing-and-generalization.md)
