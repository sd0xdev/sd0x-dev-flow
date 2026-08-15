---
name: project-setup
description: "Project configuration initialization. Use when: first-time setup, auto-detecting framework, replacing CLAUDE.md placeholders. Not for: ongoing config checks (use claude-health), skill creation (use skill-creator). Output: configured CLAUDE.md + project settings + rules + hooks."
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(node:*), Bash(git:*), Bash(ls:*), Bash(mkdir:*), Bash(diff:*), Bash(chmod:*), Bash(jq:*), Bash(bash:*)
# context: shared (default) — intentionally NOT fork because Phase 2 requires user confirmation
---

# Project Setup

## Trigger

- Keywords: project setup, init, initialize, configure project, setup CLAUDE.md, customize placeholders

## When NOT to Use

- CLAUDE.md placeholders are already fully replaced (no `{...}` remaining)
- Non Node.js/TypeScript project without a recognized manifest file -- run with `--detect-only` to see what can be auto-detected. Manual configuration may be needed for: {FRAMEWORK}, {CONFIG_FILE}, {BOOTSTRAP_FILE}. Script commands ({TEST_COMMAND}, etc.) can often be detected from manifest files
- Only want to modify a single placeholder -- just Edit CLAUDE.md directly

## Workflow

```
Phase 1: Detect project environment
    │
    ├─ Read package.json (dependencies, devDependencies, scripts)
    ├─ Detect lockfile (pnpm-lock.yaml / yarn.lock / package-lock.json)
    ├─ Detect entrypoints (glob src/)
    └─ Compile results
    │
Phase 2: Confirm detection results
    │
    ├─ Present detection results table
    └─ Wait for user confirmation or corrections
    │
Phase 3: Write to .claude/CLAUDE.md (unless --detect-only)
    │
    ├─ Read CLAUDE.template.md, filter ecosystem blocks
    └─ Replace placeholders, write to .claude/CLAUDE.md
    │
Phase 4: Verify CLAUDE.md
    │
    ├─ Read .claude/CLAUDE.md to confirm no remaining placeholders
    └─ Output placeholder summary
    │
Phase 5: Install Rules + Backfill CLAUDE.md (unless --no-rules or --lite)
    │
    ├─ Locate plugin rules dir (3-level fallback)
    ├─ mkdir -p .claude/rules/ → copy 14 managed rules + 2 override templates
    ├─ Backfill: ensure .claude/CLAUDE.md has @rules/ references
    └─ Output rules install report
    │
Phase 6: Install Hooks (unless --no-hooks or --lite)
    │
    ├─ Locate plugin hooks dir (3-level fallback)
    ├─ mkdir -p .claude/hooks/ → copy 6 hooks + chmod +x
    ├─ Merge hook definitions into .claude/settings.json
    └─ Output hooks install report
    │
Phase 6.5: Install Scripts (unless --lite or --detect-only)
    │
    ├─ Locate plugin scripts dir (3-level fallback)
    ├─ mkdir -p .claude/scripts/lib → copy 5 scripts
    ├─ Update manifest .sd0x/install-state.json
    └─ Output scripts install report
    │
Phase 6.7: Configure Environment Variables (unless --detect-only or --lite)
    │
    ├─ Detect model context size (1M → recommend auto-compact window)
    ├─ Build env var catalog (model-aware vars; flag retired STOP_GUARD_MODE for removal)
    ├─ Present recommendations, wait for user confirmation
    ├─ Merge into .claude/settings.json env object
    └─ Output env config report
    │
Phase 7: Final Verification Report
    │
    ├─ Summarize all phases
    ├─ Closed-loop check (CLAUDE.md + rules + hooks + env)
    └─ Output next steps
```

### Flag Short-Circuit Semantics

| Flag | Phase 1-2 | Phase 3-4 | Phase 5-6.5 | Phase 6.7 | Phase 7 |
|------|-----------|-----------|-----------|-----------|---------|
| (none) | Execute | Execute | Execute | Execute | Full report |
| `--detect-only` | Execute | Skip | Skip | Skip | Detection results only |
| `--lite` | Execute | Execute | Skip | Skip | CLAUDE.md only |
| `--no-rules` | Execute | Execute | Skip rules | Execute | Report |
| `--no-hooks` | Execute | Execute | Skip hooks | Execute | Report |
| `--env-only` | Skip | Skip | Skip | Execute | Env report only (skill-level directive) |

## Phase 1: Detect Project Environment

Execute the following detections in order; see `references/detection-rules.md` for detailed rules:

### Detection Steps

1. **Detect Ecosystem** — Glob for manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `build.gradle`, `pom.xml`, `Gemfile`). Priority order in `references/detection-rules.md`.
2. **Read manifest** — Extract project name, dependencies, scripts (Node.js: `package.json`; others: ecosystem manifest)
3. **Detect Package Manager** — Lockfile detection (Node.js only): `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm (priority order per `references/detection-rules.md`)
4. **Detect Framework** — From dependencies. See `references/detection-rules.md#framework`
5. **Detect Database** — From dependencies. See `references/detection-rules.md#database`
6. **Detect Entrypoints** — Glob framework-specific candidates. See `references/detection-rules.md#entrypoints`
7. **Detect Scripts** — From manifest scripts field. See `references/detection-rules.md#scripts`. Missing scripts → `# N/A (no script found)`

For non-Node.js ecosystems, skip Node-specific steps and use ecosystem-specific detection from `references/detection-rules.md`.

## Phase 2: Confirm Detection Results

Present a table of all 9 auto-detected placeholders with `| Placeholder | Detected Value | Source |` columns. Additional manual placeholders (`{TICKET_PATTERN}`, `{ISSUE_TRACKER_URL}`, `{TARGET_BRANCH}`) may remain if not auto-detectable — these are acceptable and should be noted as "manual" in Phase 4 verification.
Wait for user confirmation before proceeding to Phase 3.

## Phase 2.5: Select Ecosystem Blocks

Based on detected manifest (from Phase 1.0):

| Manifest | Ecosystem tag |
|----------|--------------|
| `package.json` | `node-ts` |
| `pyproject.toml` | `python` |
| `go.mod` | `go` |
| `Cargo.toml` | `rust` |
| `Gemfile` | `ruby` |
| `pom.xml` / `build.gradle` | `java` |

## Phase 3: Write to .claude/CLAUDE.md

**Prerequisite**: User has confirmed, and not in `--detect-only` mode.

1. Read `CLAUDE.template.md` (if not found, fallback to `CLAUDE.md`)
2. Remove `<!-- block:X -->...<!-- /block -->` sections NOT matching detected ecosystem
3. Remove remaining block markers (`<!-- block:... -->`, `<!-- /block -->`)
4. Execute `Edit` for each placeholder (using `replace_all: true`)
5. Write to `.claude/CLAUDE.md` (create directory if needed)

If `.claude/CLAUDE.md` does not exist, create it from the rendered template.

## Phase 4: Verify CLAUDE.md

1. Read `.claude/CLAUDE.md`
2. `Grep: \{[A-Z_]+\}` — confirm no remaining auto-detected placeholders. Exclude `${...}` shell variable matches (e.g., `${CLAUDE_PLUGIN_ROOT}`) from the count — these are intentional env var references, not unfilled placeholders.
3. Output summary table with all placeholder values and remaining count

If `--detect-only` or `--lite`, skip to Phase 7.

## Phase 5: Install Rules + Backfill CLAUDE.md

**Skip if**: `--no-rules` or `--lite` or `--detect-only`.

### 5.1 Locate Plugin Rules Directory

Find the plugin's `rules/` directory using this priority (short-circuit on first match):

1. **Glob search** — search known Claude plugin locations:

   ```
   Glob: ~/.claude/plugins/**/sd0x-dev-flow/rules/auto-loop.md
   Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/rules/auto-loop.md
   ```

2. **Plugin-relative fallback** — try reading `@rules/auto-loop.md` to confirm accessibility. If readable, derive the rules directory.
3. **Not found** → **hard error for this phase** (do not silently skip). Output explicit failure with remediation steps:

   ```
   ⛔ Rule source not found. Auto-loop rules cannot be installed.

   Remediation (choose one):
   1. Install the plugin: /plugin marketplace add sd0xdev/sd0x-dev-flow && /plugin install sd0x-dev-flow@sd0xdev-marketplace
   2. Copy rules manually from a machine that has the plugin installed
   3. Re-run with --no-rules to skip (rules layer will be missing)
   ```

   Then skip Phase 5 and continue to Phase 6. Phase 7 will report this as `⚠️ Partial`.

### 5.2 Copy Rules

1. `mkdir -p ${REPO_ROOT}/.claude/rules/`
2. Copy all 14 managed rules:

   | Rule | Purpose |
   |------|---------|
   | `auto-loop.md` | Auto review loop (behaviour-layer contract; hooks remind, nothing blocks) |
   | `codex-invocation.md` | Codex independent research requirement |
   | `discretion.md` | Instruction tiers: Anchor / Default / Guidance |
   | `fix-all-issues.md` | Zero tolerance for in-scope blocking findings |
   | `scope-discipline.md` | Scope axis orthogonal to severity; out-of-scope deferral |
   | `framework.md` | Framework conventions |
   | `testing.md` | Test structure and requirements |
   | `security.md` | OWASP security checklist |
   | `git-workflow.md` | Git branch and commit conventions |
   | `logging.md` | Structured logging standards |
   | `docs-writing.md` | Documentation writing conventions |
   | `docs-numbering.md` | Document numbering scheme |
   | `self-improvement.md` | Self-improvement loop |
   | `context-management.md` | Data-driven context monitoring |

3. Create override template (unmanaged, not manifest-tracked):
   - `auto-loop-project.md` · `testing-project.md` — user-owned override templates (see Phase 3.6 in `/install-rules`)

4. Conflict strategy:

   | Scenario | Action |
   |----------|--------|
   | File does not exist | **Install** |
   | File exists, content identical | **Skip** |
   | File exists, content differs | **Skip** + warn as conflict |

5. After copying, collect hashes and write manifest:
   - Compute `git hash-object --no-filters` for each managed rule (installed + already-identical skipped)
   - Read `.sd0x/install-state.json` (create `{}` if not exists)
   - Update `schema_version: 1`, `installed_at`, `plugin_version` (source priority: `.claude-plugin/plugin.json` → `package.json` → `"unknown"`), `rules` key — hash for each file in managed state (both newly installed and already-identical). Structure: `rules[filename] = { "hash": "<sha1>" }`
   - Preserve ALL other top-level keys from existing manifest (e.g. `hook_scripts`, `scripts`, `sd0x_version`, `agents_md_hash`, `hooks_installed` — do NOT drop unknown keys)
   - Write updated manifest via `Write` tool

> **Note**: `/project-setup` uses fresh-install semantics (install new / skip identical / warn on conflict; no smart merge).
> For smart merge (section merge, legacy migration, `--legacy-strategy`), run `/install-rules` directly.
> After rule installation, `/install-rules` automatically creates `auto-loop-project.md` (user-owned override template) if it doesn't exist. See `skills/install-rules/SKILL.md`.

### 5.3 Backfill CLAUDE.md (Closed-Loop Guarantee)

Ensure `.claude/CLAUDE.md` contains `@rules/` references so the auto-loop engine can activate:

1. Grep `.claude/CLAUDE.md` for `@rules/auto-loop.md`
2. **Found** → check if `@rules/auto-loop-project.md` also present:
   - **Both present** → skip (fully configured)
   - **`auto-loop.md` present, `auto-loop-project.md` missing** → insert `- @rules/auto-loop-project.md -- Project-specific auto-loop overrides (user-owned)` after `auto-loop.md` line
3. **Not found but file exists** → append `## Rules` block at end of file (16 `@rules/` references (14 managed + 2 override templates) from `CLAUDE.template.md` `## Rules` section)
4. **File does not exist** (edge case: Phase 3 was skipped) → extract from `CLAUDE.template.md`: `## Required Checks` through `### Auto-Loop Rule` sections + `## Rules` section → create minimal `.claude/CLAUDE.md`

When extracting from template, remove ecosystem block markers and leave unresolved placeholders as `{PLACEHOLDER}`.

### 5.4 Output Rules Report

```markdown
## Rules Install Report

**Source**: <plugin-rules-path>
**Target**: <repo-root>/.claude/rules/

| Rule | Status |
|------|--------|
| auto-loop.md | ✅ Installed |
| ... | ... |

**Installed**: N / **Skipped**: M / **Conflicts**: K
**Manifest**: .sd0x/install-state.json
**CLAUDE.md backfill**: ✅ @rules/ references present
```

## Phase 6: Install Hooks

**Skip if**: `--no-hooks` or `--lite` or `--detect-only`.

### 6.1 Locate Plugin Hooks Directory

Same 3-level fallback as Phase 5.1, but search for `hooks/pre-edit-guard.sh`:

1. `Glob: ~/.claude/plugins/**/sd0x-dev-flow/hooks/pre-edit-guard.sh`
2. `Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/hooks/pre-edit-guard.sh`
3. Plugin-relative fallback: `@hooks/pre-edit-guard.sh`
4. **Not found** → **hard error for this phase** (do not silently skip). Output explicit failure with remediation steps:

   ```
   ⛔ Hook source not found. The reminder-layer hooks cannot be installed.

   Remediation (choose one):
   1. Install the plugin: /plugin marketplace add sd0xdev/sd0x-dev-flow && /plugin install sd0x-dev-flow@sd0xdev-marketplace
   2. Copy hooks manually from a machine that has the plugin installed
   3. Re-run with --no-hooks to skip (reminder hooks will be missing)
   ```

   Then skip Phase 6 and continue to Phase 7. Phase 7 will report this as `⚠️ Partial`.

### 6.2 Copy Hook Scripts

1. `mkdir -p ${REPO_ROOT}/.claude/hooks/`
2. Copy 6 hooks (exclude `namespace-hint.sh` — plugin-only):

   | Hook | Event | Matcher | Purpose |
   |------|-------|---------|---------|
   | `pre-edit-guard.sh` | PreToolUse | Edit\|Write\|NotebookEdit | Block editing .env/.git |
   | `post-edit-format.sh` | PostToolUse | Edit\|Write\|NotebookEdit | Auto-format reminder |
   | `post-skill-auto-loop.sh` | PostToolUse | Skill | Post-review reminder (next gate) |
   | `stop-guard.sh` | Stop | — | Reminder: open gates at stop (markdown, exit 0) |
   | `user-prompt-review-guard.sh` | UserPromptSubmit | — | Per-prompt `[AUTO_LOOP_STATE]` fact line |
   | `post-compact-auto-loop.sh` | SessionStart | compact | Re-inject auto-loop reminders after compaction |

3. `chmod +x` each installed script.
4. Conflict strategy: same as Phase 5.2.

### 6.3 Merge Hook Definitions into Settings

Target: `${REPO_ROOT}/.claude/settings.json`

Hook definition mapping (uses `$CLAUDE_PROJECT_DIR` for portability):

```json
{
  "hooks": {
    "PreToolUse": [
      {"matcher": "Edit|Write|NotebookEdit", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/pre-edit-guard.sh"}]}
    ],
    "PostToolUse": [
      {"matcher": "Edit|Write|NotebookEdit", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-edit-format.sh"}]},
      {"matcher": "Skill", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-skill-auto-loop.sh"}]}
    ],
    "Stop": [
      {"matcher": "", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/stop-guard.sh"}]}
    ],
    "UserPromptSubmit": [
      {"matcher": "", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/user-prompt-review-guard.sh"}]}
    ],
    "SessionStart": [
      {"matcher": "compact", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-compact-auto-loop.sh"}]}
    ]
  }
}
```

> **Note**: Environment variables are configured in **Phase 6.7** (independent of hook installation). Phase 6.3 only handles hook definition merging.

Merge strategy:
- Read existing settings file (create `{}` if not exists)
- **Legacy migration**: scan for bare `.claude/hooks/<name>.sh` paths → upgrade to `"$CLAUDE_PROJECT_DIR"/.claude/hooks/<name>.sh`
- For each event: append-only merge (skip if same command path exists)
- **Coexistence detection**: if `hooks/hooks.json` exists at repo root (= plugin source repo), warn that plugin hooks and installed hooks may coexist. Runtime arbitration handles dedup automatically
- Write updated settings back (hook definitions only — env vars deferred to Phase 6.7)

### 6.4 Output Hooks Report

```markdown
## Hooks Install Report

**Source**: <plugin-hooks-path>
**Scripts**: <repo-root>/.claude/hooks/
**Settings**: <repo-root>/.claude/settings.json

| Hook | Script | Settings | Status |
|------|--------|----------|--------|
| pre-edit-guard.sh | ✅ Copied | ✅ Added | Installed |
| ... | ... | ... | ... |

**Installed**: N / **Skipped**: M / **Conflicts**: K
```

## Phase 6.5: Install Scripts

**Skip if**: `--lite` or `--detect-only`.

### 6.5.1 Locate Plugin Scripts Directory

Same 3-level fallback as Phase 5.1, but search for `scripts/precommit-runner.js`:

1. `Glob: ~/.claude/plugins/**/sd0x-dev-flow/scripts/precommit-runner.js`
2. `Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/scripts/precommit-runner.js`
3. Plugin-relative fallback: `@scripts/precommit-runner.js`

**Not found** → warn + skip Phase 6.5. Phase 7 will report `⚠️ Partial`.

### 6.5.2 Copy Scripts

1. `mkdir -p ${REPO_ROOT}/.claude/scripts/lib`
2. Copy 5 scripts:

| Script | Purpose | Dependencies |
|--------|---------|--------------|
| `precommit-runner.js` | Precommit runner for `/precommit`, `/precommit-fast`; notes its own pass/fail via `review-state.js` | `lib/utils.js`, `review-state.js` |
| `verify-runner.js` | Verify runner for `/verify` | `lib/utils.js` |
| `review-state.js` | Reminder-state checker/noter (single slot per plane under `~/.cache/sd0x-dev-flow/`) read by the locally installed hooks and by `/remind`, `/next-step`, `/pre-pr-audit` | `lib/tree-digest.js` |
| `lib/utils.js` | Shared utilities | None |
| `lib/tree-digest.js` | Per-plane content digests (binds a noted verdict to the tree that earned it) | None |

1. Conflict strategy: same as Phase 5.2.

| Scenario | Action |
|----------|--------|
| File does not exist | Install |
| File exists, content identical | Skip |
| File exists, content differs | Skip + warn as conflict |

### 6.5.3 Update Manifest

1. Read `.sd0x/install-state.json` (create `{}` if not exists)
2. Read plugin version from `.claude-plugin/plugin.json` or `package.json`
3. Update: `schema_version: 1`, `installed_at`, `plugin_version`, `scripts` key
4. Compute hash per file: `git hash-object --no-filters .claude/scripts/<name>`
5. Preserve all existing top-level keys (e.g. `rules`, `hook_scripts`, and any unknown keys)
6. Write back to `.sd0x/install-state.json`

### 6.5.4 Output Scripts Report

```markdown
## Scripts Install Report

**Source**: <plugin-scripts-path>
**Target**: <repo-root>/.claude/scripts/

| Script | Status |
|--------|--------|
| precommit-runner.js | Installed/Skipped/Conflict |
| verify-runner.js | Installed/Skipped/Conflict |
| review-state.js | Installed/Skipped/Conflict |
| lib/utils.js | Installed/Skipped/Conflict |
| lib/tree-digest.js | Installed/Skipped/Conflict |

**Installed**: N / **Skipped**: M / **Conflicts**: K
```

## Phase 6.7: Configure Environment Variables

**Skip if**: `--detect-only` or `--lite`.
**Run exclusively with**: `--env-only` (skip all other phases, jump directly to 6.7 → 7).

**Purpose**: Write recommended environment variables to `.claude/settings.json` `env` object, **independent of hook installation**. This phase runs even when `--no-hooks` is specified.

### 6.7.1 Env Var Catalog

| Variable | Default | Condition | Description |
|----------|---------|-----------|-------------|
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `320000` | 1M context model detected | Auto-compact window size (tokens) — delays compaction to preserve more context |

#### Legacy Recommendations (auto-upgrade prompt)

When an existing setting matches a previously recommended value (not the current one), flag it as `Upgrade` in the interactive table so the user can explicitly confirm the change. Never rewrite silently.

| Variable | Legacy value(s) | Current recommended | Retired on |
|----------|-----------------|---------------------|------------|
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `456000` | `320000` | 2026-04-17 |
| `STOP_GUARD_MODE` | `strict`, `warn` (any value) | **Remove** — the Stop hook is reminder-only since hook-lightweighting; the setting is dead config | 2026-08-13 |

### 6.7.2 Large Context Model Detection

Determine whether `CLAUDE_CODE_AUTO_COMPACT_WINDOW` should be recommended:

1. **Self-awareness check**: Claude can inspect its own system environment description for "1M context" indicators (e.g. model description includes "1M context" or "(with 1M context)")
2. **Detected** → include `CLAUDE_CODE_AUTO_COMPACT_WINDOW: "320000"` in recommendations with note: "1M context model detected"
3. **Not detected or uncertain** → ask user: "Are you using a 1M context model? (e.g. Claude Opus 4.6 1M)" — include in recommendations only on confirmation
4. **User declines** → omit `CLAUDE_CODE_AUTO_COMPACT_WINDOW` from recommendations

### 6.7.3 Interactive Flow

1. Read existing `env` values from **both** `.claude/settings.local.json` and `.claude/settings.json` (create `{}` if not exists). Runtime precedence: `settings.local.json` > `settings.json`
2. Build recommendations table showing **effective** current value:

   ```markdown
   ## Environment Variables

   Only one row per variable appears at a time; the examples below are **alternatives** for the same variable, selected by its current state.

   Example A — first-time install (variable not yet set):

   | Variable | Current (effective) | Source | Recommended | Action |
   |----------|---------------------|--------|-------------|--------|
   | CLAUDE_CODE_AUTO_COMPACT_WINDOW | (not set) | — | 320000 | Add (1M model) |

   Example B — upgrade path (variable already set to a legacy value):

   | Variable | Current (effective) | Source | Recommended | Action |
   |----------|---------------------|--------|-------------|--------|
   | CLAUDE_CODE_AUTO_COMPACT_WINDOW | 456000 | settings.json | 320000 | **Upgrade** (legacy value, retired 2026-04-17) |
   ```

3. Present to user for confirmation — user may accept all, modify values, or skip specific vars. For rows marked `Upgrade`, display the retirement date and reason so the user can make an informed decision.
4. Apply confirmed changes to `.claude/settings.json` (default) or `.claude/settings.local.json` (with `--local`)

### 6.7.4 Merge Strategy

- Read existing settings file (create `{}` if not exists)
- Merge env vars into `env` object:
  - If key does not exist → **Add**
  - If key exists and value matches current recommended → **Skip**
  - If key exists and value matches a **Legacy value** listed in 6.7.1 → **Upgrade** (surface retirement date + reason; apply only after user confirmation, never silently overwrite)
  - If key exists and value is user-custom (neither current nor legacy) → **Update** (only after user confirmation; default to preserving)
- Preserve all existing `env` keys not in the catalog (do not drop unknown keys)
- Preserve all non-`env` keys in settings (hooks, etc.)
- Write updated settings back

### 6.7.5 Interaction with Phase 6.3 and `/install-hooks`

- Phase 6.3 (within `/project-setup`) defers env writes to Phase 6.7
- When both run in the same session, Phase 6.7 runs after Phase 6 and writes to the same target file
- `--no-hooks` skips Phase 6 but Phase 6.7 still runs → env vars are always configured

### 6.7.6 Output Env Config Report

```markdown
## Environment Config Report

**Target**: <repo-root>/.claude/settings.json (or settings.local.json with --local)

| Variable | Value | Effective Source | Status |
|----------|-------|-----------------|--------|
| CLAUDE_CODE_AUTO_COMPACT_WINDOW | 320000 | settings.json | ✅ Added (1M model) — or ✅ Upgraded (456000 → 320000, legacy retired 2026-04-17) when upgrading |

**Model**: Opus 4.6 (1M context) → auto-compact window recommended
**Precedence note**: Runtime resolves env > settings.local.json > settings.json > default
```

## Phase 7: Final Verification Report

Summarize all phases and perform closed-loop check:

### Closed-Loop Check

| Condition | Check | Required |
|-----------|-------|----------|
| CLAUDE.md behavior text | `Required Checks` section exists | ✅ |
| `@rules/` references | `@rules/auto-loop.md` in `.claude/CLAUDE.md` | ✅ |
| Rule files | `.claude/rules/auto-loop.md` exists | ✅ |
| Hook reminders | `stop-guard` in `.claude/settings.json` | ✅ |
| Script runners | `.claude/scripts/precommit-runner.js` exists | ✅ (unless `--lite` or `--detect-only`) |
| Auto-compact window | `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` in target settings file | ✅ (1M model only) |

### Output

```markdown
## Project Setup Complete

| Phase | Status |
|-------|--------|
| Detection | ✅ Framework: X, PM: Y, DB: Z |
| CLAUDE.md | ✅ Configured (0 remaining placeholders) |
| Rules | ✅ 14/14 managed rules + 2 override templates |
| Hooks | ✅ 6/6 installed + settings merged |
| Scripts | ✅ 5/5 scripts installed |
| Env Config | ✅ AUTO_COMPACT_WINDOW=320000 (1M) |

### Closed-Loop Status
✅ Auto-loop reminder loop fully configured
(or ⚠️ Partial — missing: hooks (reminder layer inactive))
(or ⚠️ Partial — missing: rules)
(or ⚠️ Partial — missing: scripts (runner not installed))
(or ℹ️ Auto-compact window not set — standard context model detected)

### Next Steps
- Run `/repo-intake` for a full project scan
- Use `HOOK_BYPASS=1` as emergency escape hatch
- Use `/install-rules --force` to upgrade rules later
```

## Verification

- [ ] All 9 auto-detected placeholders detected or marked N/A
- [ ] User confirmed detection results before writing
- [ ] No remaining auto-detected `{UPPER_CASE}` placeholders in `.claude/CLAUDE.md` after setup (manual placeholders like `{TICKET_PATTERN}` are acceptable)
- [ ] `.claude/rules/` contains 16 `.md` files (14 managed + 2 override templates) (unless `--no-rules` or `--lite`)
- [ ] `.claude/hooks/` contains 6 `.sh` files with execute permission (unless `--no-hooks` or `--lite`)
- [ ] `.claude/settings.json` contains hook definitions (unless `--no-hooks` or `--lite`)
- [ ] `.claude/scripts/` contains `precommit-runner.js`, `verify-runner.js`, `review-state.js`, `lib/utils.js`, and `lib/tree-digest.js` (unless `--lite` or `--detect-only`)
- [ ] `.claude/CLAUDE.md` contains `@rules/auto-loop.md` reference (unless `--lite`)
- [ ] `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set in target settings file when 1M model detected (unless `--detect-only` or `--lite`)

## References

See detection rules: [detection-rules.md](./references/detection-rules.md)
