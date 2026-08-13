---
name: claude-health
description: "Claude Code config health check + plugin sync. Use when: auditing .claude/ structure, checking naming, verifying hook setup, detecting plugin version drift, syncing installed assets. Not for: skill quality (use skill-health-check), code review (use codex-code-review). Output: health report + fix recommendations."
allowed-tools: Read, Grep, Glob, Bash(ls:*), Bash(find:*), Bash(wc:*), Bash(du:*), Bash(rm:*), Bash(git:*)
context: fork
---

# Claude Health Check

## Trigger

- Keywords: health check, .claude check, config audit, lint .claude, claude health, plugin sync, version drift, upgrade check, doctor

## When NOT to Use

- Code review (use `/codex-review-fast`)
- Doc review (use `/codex-review-doc`)
- Security review (use `/codex-security`)

## Scope

| Argument | Description |
|----------|-------------|
| `--scope hygiene` | Only run C1-C7 hygiene checks |
| `--scope sync` | Only run S1-S3 sync checks |
| `--scope all` | Run both modules (**default**) |

## Workflow

```
[--scope] → Select modules → Scan → Classify → Report → Fix suggestions
               │                                  │
       ┌───────┴───────┐                     P0/P1/P2
       ▼               ▼                    + fix commands
  Hygiene (C1-C7)  Sync (S1-S3)
```

### Hygiene Module — Checks (7 items)

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| 1 | Junk files | `find .claude/ -name ".DS_Store" -o -name "*.zip" -o -name ".tmp*"` | Any exists → P1 |
| 2 | .gitignore exists | `ls .claude/.gitignore` | Missing → P1 |
| 3 | .gitignore completeness | Read `.claude/.gitignore`, compare required items | Missing required → P2 |
| 4 | Naming consistency | Scan all `skills/*/` for `reference` vs `references` | Inconsistent → P2 |
| 5 | README count sync | Count actual vs README description | Mismatch → P2 |
| 6 | Command-Skill pairing | Each core skill should have corresponding command | Missing → P1 |
| 7 | Cache size | `du -sh .claude/cache/` | > 50M → P2 |

### Check 1: Junk Files

```bash
find .claude/ -name ".DS_Store" -o -name "*.zip" -o -name ".tmp*" 2>/dev/null
```

- Has results → **P1**: List files, suggest deletion
- No results → ✅

### Check 2-3: .gitignore

```bash
ls .claude/.gitignore 2>/dev/null || echo "MISSING"
```

Missing → **P1**. If exists, read content and compare required items:

| Required Item | Reason |
|---------------|--------|
| `.DS_Store` | macOS generates continuously |
| `settings.local.json` | Personal config |
| `cache/` | Runtime cache |
| `.tmp*` | Temp files |
| `*.tmp` | Temp files (suffix variant) |
| `*.zip` | Backup archives |
| `.claude_review_state.json` | Review state tracking |

Missing any → **P2**

### Check 4: Naming Consistency

```bash
# Scan all skill subdirectories
for dir in .claude/skills/*/; do
  if [ -d "${dir}reference" ]; then echo "INCONSISTENT: ${dir}reference"; fi
done
```

Has `reference/` (singular) → **P2**, suggest renaming to `references/`

### Check 5: README Count Sync

```bash
# Count actual items
ls .claude/commands/ 2>/dev/null | wc -l
ls .claude/skills/ 2>/dev/null | wc -l
ls .claude/agents/ 2>/dev/null | wc -l
ls .claude/rules/ 2>/dev/null | wc -l
ls .claude/hooks/*.sh 2>/dev/null | wc -l
```

Extract counts from README.md, compare. Mismatch → **P2**

### Check 6: Command-Skill Pairing

Scan all `skills/*/SKILL.md`, exclude these types, then check for corresponding command:

| Exclude Type | Examples | Reason |
|--------------|----------|--------|
| Domain KB | `portfolio`, `aum` | Referenced by other skills, no standalone entry |
| External | `agent-browser` | Not maintained by this project |

Remaining skills without command → **P1**

### Check 7: Cache Size

```bash
du -sh .claude/cache/ 2>/dev/null
```

- \> 50M → **P2**, suggest cleanup
- ≤ 50M → ✅

### Sync Module — Checks (S1-S3)

> Only runs when `--scope sync` or `--scope all` (default).

#### S1: Version Check

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| S1.1 | Manifest exists | Read `.sd0x/install-state.json` | Missing → P1 |
| S1.2 | Manifest parseable | JSON.parse | Parse error → P1 |
| S1.3 | `schema_version` current | `== 1` | Mismatch → P2 |
| S1.4 | `plugin_version` matches | manifest vs `.claude-plugin/plugin.json` or `package.json` | Mismatch → P1 |
| S1.5 | Manifest completeness | Has `rules` + `hook_scripts` + `scripts` keys | Missing key → P2 (`MANIFEST_GAP`) |

**Plugin version resolution** (priority order):

```
.claude-plugin/plugin.json → package.json → "unknown"
```

**Plugin source location** (same as `/install-rules` Phase 1):

```
Glob: ~/.claude/plugins/**/sd0x-dev-flow/rules/auto-loop.md
Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/rules/auto-loop.md
Fallback: @rules/auto-loop.md (plugin-relative)
```

#### S2: Component Classification

For each managed component (rules, hooks, scripts), compute 3 hashes and classify:

```bash
manifest_hash  = manifest[category][filename].hash    # null if missing
local_hash     = git hash-object --no-filters <local-path>  # null if file missing
plugin_hash    = git hash-object --no-filters <plugin-path>  # source of truth
```

**Classification table** (read-only diagnostic; maps to install-rules states for delegation):

| Doctor State | Condition | Severity | install-rules Equivalent |
|-------|-----------|----------|--------------------------|
| `OK` | local == manifest == plugin | ✅ | `SKIP` |
| `MISSING` | local_hash is null, plugin exists | P1 | `FRESH_INSTALL` |
| `OUTDATED` | local == manifest, plugin != manifest | P1 | `AUTO_UPDATE` |
| `LOCAL_MODIFIED` | local != manifest, plugin == manifest | ✅ | `KEEP_LOCAL` |
| `CONFLICT` | local != manifest, plugin != manifest | P2 | `CONFLICT` |
| `LEGACY` | manifest_hash is null, local exists | P2 | `LEGACY` |
| `MANIFEST_GAP` | manifest category key missing | P2 | N/A |
| `TOMBSTONED` | manifest `deleted: true`, local missing | ✅ | `SKIP_DELETED` |

**Managed inventory** (hardcoded):

| Category | Local Path | Plugin Source | Files |
|----------|-----------|--------------|-------|
| Rules | `.claude/rules/*.md` | `rules/*.md` | `auto-loop.md`, `codex-invocation.md`, `fix-all-issues.md`, `framework.md`, `testing.md`, `security.md`, `git-workflow.md`, `logging.md`, `docs-writing.md`, `docs-numbering.md`, `self-improvement.md`, `context-management.md` |
| Hooks | `.claude/hooks/*.sh` | `hooks/*.sh` | `pre-edit-guard.sh`, `post-edit-format.sh`, `post-tool-review-state.sh`, `stop-guard.sh`, `post-compact-auto-loop.sh` |
| Scripts | `.claude/scripts/` | `scripts/` | `precommit-runner.js`, `verify-runner.js`, `dispatch-cli.js`, `dep-audit.sh`, `commit-msg-guard.sh`, `pre-push-gate.sh`, `lib/utils.js`, `lib/tree-digest.js`, `lib/receipt-log.js`, `lib/dispatch-log.js`, `lib/gate-derive.js` |

#### S2.5: Override Safeguard Checks

6 checks for project override files (e.g., `auto-loop-project.md`):

| # | Check | Severity | Detection | Recommendation |
|---|-------|----------|-----------|----------------|
| 1 | Override drift | P2 | `based_on` hash comment in project file vs the hash of **the base file that comment names** (derived, never hard-coded — both `auto-loop-project.md` and `testing-project.md` ship) — **only when the override file has active content**; a scaffold with every section still commented out has no overrides to review, so drift is not reported | "Base `<rule>` updated since override authored; review your overrides" |
| 2 | Policy contradiction | P1 | An overridden section omits a required check command that the **same section** of the base rule contains | "Override conflicts with stop-guard enforcement" |
| 3 | Missing reference or base | P1 | For **each** shipped override file (`auto-loop-project.md`, `testing-project.md`): `.claude/CLAUDE.md` has `@rules/<file>` but the file is missing, OR the file exists but is not referenced, OR the file exists but the base rule its `Based on:` comment names is missing from `.claude/rules/` | `/install-rules` to recreate the missing file or base, or add the reference |
| 4 | Wrong-layer edit | P2 | Base `auto-loop.md` has `LOCAL_MODIFIED`, `CONFLICT`, or `LEGACY` state while project override exists | "Move customization to auto-loop-project.md" |
| 5 | Duplicate heading | P2 | Override file has multiple active `## <heading>` with same text | "Keep one, remove duplicates. Last occurrence takes effect." |
| 6 | Legacy precedence header | P2 | Precedence declaration exists only inside an HTML comment (`<!-- Precedence:` present, no live `Precedence:` line before the first `##`) — HTML comments are stripped from model context (R8), so the declaration never reaches its only reader | "Header predates the live-precedence contract; migrate the precedence line to live text by hand or regenerate via `/install-rules --customize <rule> --reset`. This check is **read-only** — it never edits the user-owned file" |

**Policy contradiction detection**: For each `## <heading>` section the override restates, extract the backticked check commands (`/codex-review-fast`, `/codex-review-doc`, `/precommit`) from the **same-heading section of the base `auto-loop.md`** and require the restated section to keep every one of them. A verbatim copy therefore never flags; only a restatement that *drops* a command its base section carries is P1. (The base's Auto-Trigger table was retired by R3 — code/doc routing now lives in the unheaded terminal-invariant paragraph, which the exact-`##`-heading override mechanism cannot restate, so routing itself is not overridable and is out of this check's scope.) No restated section → check passes vacuously.

**Override drift detection**: First check whether the project file has **active content**. Two forms count, and the distinction matters because the scaffold ships its `##` headings live: a non-empty, non-comment **body line** under any heading, or a **heading that carries its own value** (`## Plan Review: enabled`, `## Git Memory: enabled` — for these settings the heading *is* the value, so there is no body to look for). A bare scaffold heading with nothing but comments beneath it is an empty slot, not an override. The live `Precedence:` header is preamble material and never activation. A scaffold whose sections are all still commented out is skipped: drift means "the base changed since you wrote your overrides", and there are none, so reporting it on a fresh install is a false positive rather than a finding. Otherwise read the `<!-- Based on: <base>.md @ <hash> -->` comment and **derive the base file from the comment's own filename** — `git hash-object --no-filters .claude/rules/<base>.md | cut -c1-7`. The base must not be hard-coded: R8 distributes `testing-project.md` alongside `auto-loop-project.md`, so a fixed `auto-loop.md` comparand would check a testing override's hash against the wrong rule and report drift that does not exist. If the derived base file is missing, drift is undefined rather than zero — report it through check #3's **missing base** branch (P1) and do not emit a drift finding. Both checks must cover every shipped override file, not just `auto-loop-project.md`: an active `testing-project.md` whose `testing.md` has been deleted would otherwise fall through both. If the hashes differ, the base has been updated since the override was authored. Uses blob hash for content-level comparison; accepts legacy commit-style hashes (any 7+ hex chars) during backward-compat transition.

#### S3: Settings Compatibility

Check **both** `settings.json` and `settings.local.json` (precedence: `settings.local.json` > `settings.json`). A hook entry in either file satisfies the integrity check.

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| S3.1 | Legacy hook paths | Grep both settings files for bare `.claude/hooks/` without `$CLAUDE_PROJECT_DIR` | Found → P2 |
| S3.2 | `STOP_GUARD_MODE` present | Read `env.STOP_GUARD_MODE` from either settings file (also check legacy `hooks_config.stop_guard_mode`) | Missing from both → P2 (info). Legacy `hooks_config` found → P2 (migration recommended). Install-time default: `strict`; runtime fallback: `warn` |
| S3.3 | Hook entry integrity | Each installed hook script has matching entry in either settings file | Missing from both → P1 |
| S3.4 | Orphan hook entries | Either settings file references script that doesn't exist on disk | Orphan → P2 |

**Settings file precedence**: `settings.local.json` overrides `settings.json` at runtime. When delegating S3 fixes, use `/install-hooks --local` if the issue is in `settings.local.json`.

**Legacy path detection**:

```
Grep for: "\.claude/hooks/[^"]+\.sh"  (without leading "$CLAUDE_PROJECT_DIR")
Applied to both: settings.json and settings.local.json
```

### Fix Tiers

> Only applies when `--fix-safe` or `--fix` is specified alongside sync scope.

| Tier | Flag | Description |
|------|------|-------------|
| Report | (default) | Diagnosis only — output actionable recommendations |
| Safe | `--fix-safe` | Auto-fix P1 hygiene + safe sync fixes |
| Guided | `--fix` | Auto-fix P1 hygiene + guided sync remediation (interactive) |

**Category-specific safe fix delegation**:

| Category | `MISSING` | `OUTDATED` | `CONFLICT`/`LEGACY` |
|----------|----------|-----------|---------------------|
| Rules | `/install-rules <names>` | `/install-rules <names>` (smart merge AUTO_UPDATE) | Skip (report only) |
| Hooks | `/install-hooks <names>` | Report only + suggest `/install-hooks <names> --force` | Skip (report only) |
| Scripts | `/install-scripts <names>` | Report only + suggest `/install-scripts <names> --force` | Skip (report only) |

> **Why hooks/scripts OUTDATED is report-only in safe tier**: `/install-hooks` and `/install-scripts` use skip/force semantics (no manifest-aware smart merge). Only `/install-rules` has 7-state classification for safe auto-update.

**S3 settings fix delegation**: All settings mutations delegate to `/install-hooks` (sync module never writes JSON directly).

**`--fix` tier**: Delegates all actionable states (including CONFLICT, LEGACY) to `/install-*` commands which handle interactive resolution.

**Argument conflict**: `--fix` and `--fix-safe` are mutually exclusive. If both specified, error.

## Output

```markdown
# .claude/ Health Check Report

## Hygiene Summary (C1-C7)

| Item | Status | Notes |
|------|--------|-------|
| Junk files | ✅/⛔ | ... |
| .gitignore | ✅/⛔ | ... |
| Naming consistency | ✅/⛔ | ... |
| README count | ✅/⛔ | ... |
| Command-Skill | ✅/⛔ | ... |
| Cache size | ✅/⛔ | ... |

## Sync Summary (S1-S3)

### S1: Version
| Check | Status | Detail |
|-------|--------|--------|
| Manifest | ✅/⛔ | Found / Missing |
| Plugin version | ✅/⛔ | 2.0.3 == 2.0.3 / 1.8.12 → 2.0.3 |
| Manifest keys | ✅/⛔ | Complete / Missing: hook_scripts, scripts |

### S2: Component Status
| File | Category | Status | Action |
|------|----------|--------|--------|
| auto-loop.md | Rules | OUTDATED | `/install-rules auto-loop` |
| security.md | Rules | OK | — |
| stop-guard.sh | Hooks | MISSING | `/install-hooks stop-guard` |
| ... | ... | ... | ... |

### S3: Settings Compatibility
| Check | Status | Detail |
|-------|--------|--------|
| Hook paths | ✅/⛔ | Modern / Legacy found |
| Guard mode | ✅/⛔ | strict / Missing |
| Entry integrity | ✅/⛔ | All matched / N missing |
| Orphan entries | ✅/⛔ | None / N orphans |

## Statistics

| Category | Count |
|----------|-------|
| Commands | N |
| Skills | N |
| Rules | N (installed) / N (managed) |
| Hooks | N |

## Issues

### P1
- [Issue] → [Fix recommendation / command]

### P2
- [Issue] → [Fix recommendation]

## Gate
✅ All Pass / ⛔ N issues need fixing
```

## Verification

- [ ] Hygiene: All 7 checks executed (when scope includes hygiene)
- [ ] Sync: S1-S3 checks executed (when scope includes sync)
- [ ] Each check has clear ✅/⛔ status
- [ ] P1 issues have specific fix commands
- [ ] S2 classification covers all 23 managed files
- [ ] Fix delegation uses targeted file names (not `--all`)

## References

- `references/best-practices.md` — Best practices for .claude/ directory structure

## Examples

```
Input: /claude-health
Action: Scan hygiene (7 items) + sync (S1-S3) → Generate consolidated report

Input: /claude-health --scope sync
Action: Scan S1-S3 only → Report version drift + component status

Input: /claude-health --fix-safe
Action: Scan all → Auto-fix safe items → Delegate to /install-* → Report

Input: Is my plugin up to date?
Action: Trigger sync check → Report version + component drift
```
