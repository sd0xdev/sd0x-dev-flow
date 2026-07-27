# Phase D: Hook Hardening

> 本文自 [`2-tech-spec.md`](./2-tech-spec.md) 拆出（§ Size Limit，`rules/docs-numbering.md`）。編號 1 是子文件序號，不代表 lifecycle phase。

## Phase D: Hook Hardening（Deep Research 2026-03-31 識別）

> 來源：`/deep-research` codex-plugin-cc 可借鑑做法 + 現有 auto-loop 24-finding 缺口分析

### D-1: `stop_hook_active` Recursion Guard（P0）

**Problem**: Strict mode `exit 2` → Claude 回應 → 再 stop → 再 `exit 2` → infinite loop。

**Solution**: 在 `stop-guard.sh` 頂部檢查 stdin JSON 的 `stop_hook_active` flag：

```bash
# Near top of stop-guard.sh, after reading INPUT
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [[ "$STOP_HOOK_ACTIVE" == "true" ]]; then
  exit 0  # Prevent infinite recursion
fi
```

**Files**: `hooks/stop-guard.sh`（3 行）
**Source**: claudefa.st + community patterns

### D-2: Session Lifecycle Reset（P1）

**Problem**: `.claude_review_state.json` 跨 session 持久化，`session_id` 為空 → 上次 session 未完成的 review state 影響新 session。

**Solution**: 新增 SessionStart hook，初始化 state file：

```bash
#!/usr/bin/env bash
# hooks/session-init.sh — SessionStart hook
STATE_FILE=".claude_review_state.json"
INPUT=$(cat)
NEW_SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)

if [[ -z "$NEW_SESSION_ID" ]]; then exit 0; fi

if [[ -f "$STATE_FILE" ]]; then
  OLD_SESSION_ID=$(jq -r '.session_id // empty' "$STATE_FILE" 2>/dev/null)
  if [[ "$OLD_SESSION_ID" != "$NEW_SESSION_ID" && -n "$OLD_SESSION_ID" ]]; then
    # New session — reset review state, preserve iteration_history.total_rounds_session
    jq --arg sid "$NEW_SESSION_ID" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '.session_id = $sid | .updated_at = $now |
       .has_code_change = false | .has_doc_change = false |
       .code_review = {"executed":false,"passed":false} |
       .doc_review = {"executed":false,"passed":false} |
       .precommit = {"executed":false,"passed":false} |
       .aggregate_gate = {"executed":false} |
       .iteration_history.current_round = 0 |
       .iteration_history.findings_by_round = []' \
      "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
  fi
else
  # First session — create minimal state
  echo "{\"schema_version\":2,\"session_id\":\"$NEW_SESSION_ID\"}" > "$STATE_FILE"
fi
```

**hooks.json 變更**（additive — append to existing SessionStart array，不取代 namespace-hint 和 compact hooks）:

```json
// Append this entry to the existing "SessionStart" array in hooks.json
{
  "matcher": "startup",
  "hooks": [{
    "type": "command",
    "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-init.sh",
    "timeout": 5
  }]
}
```

> **Note**: hooks.json 已有 SessionStart entries（namespace-hint、compact reinjection）。此 entry 需 append 而非 replace。確保符合 `hooks-json-registry.test.js` 的 matcher 約束。

**Files**: 新增 `hooks/session-init.sh` + 更新 `hooks/hooks.json`
**Source**: codex-plugin-cc `session-lifecycle-hook.mjs`

### D-3: `changed_files` 陣列追蹤（P1）

**Problem**: State file 只記錄 `has_code_change` boolean，不知道哪些 files 變了 → stop-guard 無法判斷 review 是否覆蓋所有已變更檔案。

**Solution**: 在 `post-edit-format.sh` 追蹤 changed files，review pass 後 reset：

```bash
# In post-edit-format.sh, after setting has_code_change/has_doc_change
_track_changed_file() {
  local file_path="$1" state_file="$2" tmp
  tmp=$(mktemp)
  jq --arg f "$file_path" \
    'if .changed_files_since_review then
       .changed_files_since_review |= (. + [$f] | unique)
     else
       .changed_files_since_review = [$f]
     end' "$state_file" > "$tmp" && mv "$tmp" "$state_file"
}

# In post-tool-review-state.sh, when code_review passes
_reset_changed_files() {
  local state_file="$1" tmp
  tmp=$(mktemp)
  jq '.changed_files_since_review = []' "$state_file" > "$tmp" && mv "$tmp" "$state_file"
}
```

**State schema v2 additive field** (backward compatible via jq `// []` fallback — existing v2 state files without `changed_files_since_review` continue to work without migration):

```json
{
  "changed_files_since_review": ["scripts/lib/utils.js", "skills/next-step/scripts/analyze.js"]
}
```

**Files**: `hooks/post-edit-format.sh` + `hooks/post-tool-review-state.sh`
**Source**: O'Reilly "Auto-Reviewing Claude's Code"

### D-4: Review Phase State（P2）

**Problem**: State file 只追蹤 review 是否執行過，不追蹤當前所處階段 → stop-guard 無法區分「尚未開始 review」和「review 正在進行中」。

**Solution**: 新增 `review_phase` 欄位：

```json
{
  "review_phase": "idle" | "pending_review" | "addressing_findings" | "precommit_pending"
}
```

| Event | Phase 轉換 |
|-------|-----------|
| 程式碼編輯 | → `pending_review` |
| Emit PENDING gate | → `pending_review` |
| Emit READY gate | → `precommit_pending` |
| Emit BLOCKED gate | → `addressing_findings` |
| Precommit pass | → `idle` |

**stop-guard.sh 增強**:

```bash
case "$REVIEW_PHASE" in
  pending_review)
    MISSING="$MISSING /codex-review-fast" ;;
  addressing_findings)
    MISSING="$MISSING fix-P0P1-then-re-review" ;;
  precommit_pending)
    MISSING="$MISSING /precommit-fast" ;;
  idle)
    ;; # No pending obligations
esac
```

**Files**: `hooks/post-tool-review-state.sh` + `hooks/post-edit-format.sh` + `hooks/stop-guard.sh`
**Source**: hamelsmu/claude-review-loop two-phase state machine

### D-5: Structured Output Schema（P2，incremental）

**Problem**: Sentinel parsing（`✅ Ready`、`## Gate: ✅`）用 regex，Codex 輸出格式變化時靜默失敗。

**Solution**: 保持 text sentinel 為 primary gate，新增 optional JSON structured output 作為 secondary enrichment。

**在 review prompt 末尾新增**:

```markdown
## Structured Output (optional, after text report)

If possible, also output a JSON block at the end of your review:

\`\`\`json
{
  "gate": "READY" | "BLOCKED",
  "findings_count": { "p0": N, "p1": N, "p2": N, "nit": N },
  "top_finding": { "severity": "P1", "file": "path", "line": N, "issue": "..." }
}
\`\`\`
```

**post-tool-review-state.sh 增強**:

```bash
# Try structured JSON first, fallback to text sentinel
_parse_review_gate() {
  local output="$1" json_gate
  # Try JSON block
  json_gate=$(echo "$output" | sed -n '/^```json$/,/^```$/p' | sed '1d;$d' | jq -r '.gate // empty' 2>/dev/null)
  if [[ -n "$json_gate" ]]; then
    echo "$json_gate"
    return
  fi
  # Fallback to text sentinel
  if echo "$output" | grep -q '✅ Ready'; then echo "READY"
  elif echo "$output" | grep -q '⛔ Blocked'; then echo "BLOCKED"
  else echo "UNKNOWN"
  fi
}
```

**Files**: `codex-prompt-fast.md` + `post-tool-review-state.sh`
**Source**: codex-plugin-cc `review-output.schema.json`

---

## Phase D Work Breakdown

| Task | Est. | Priority | Dependency | Files |
|------|------|----------|------------|-------|
| D-1: Recursion guard | 0.25d | P0 | — | `hooks/stop-guard.sh` |
| D-2: Session lifecycle | 1d | P1 | — | New `hooks/session-init.sh` + `hooks/hooks.json` |
| D-3: changed_files tracking | 1d | P1 | D-2 | `hooks/post-edit-format.sh` + `hooks/post-tool-review-state.sh` |
| D-4: Review phase state | 1.5d | P2 | D-3 | `hooks/post-tool-review-state.sh` + `hooks/stop-guard.sh` |
| D-5: Structured output | 1d | P2 | — | `codex-prompt-*.md` + `hooks/post-tool-review-state.sh` |
| D-T: Tests for D-1~D-5 | 1.5d | P1 | D-1~D-5 | `test/hooks/stop-guard.test.js` + new test files |

**Phase D total**: ~6.25 人天
**Grand total (Phase A+B+C+D)**: ~15.25 人天

## Phase D Testing Strategy

| Task | Test Type | Test File |
|------|-----------|-----------|
| D-1 | Unit | `test/hooks/stop-guard.test.js`（新增 recursion guard case） |
| D-2 | Unit | `test/hooks/session-init.test.js` |
| D-3 | Unit | `test/hooks/changed-files.test.js` |
| D-4 | Unit + Integration | `test/hooks/review-phase.test.js` |
| D-5 | Unit | `test/hooks/structured-output-parse.test.js` |
