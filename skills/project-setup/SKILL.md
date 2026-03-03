---
name: project-setup
description: "Project configuration initialization. Use when: first-time setup, auto-detecting framework, replacing CLAUDE.md placeholders. Not for: ongoing config checks (use claude-health), skill creation (use create-skill). Output: configured CLAUDE.md + project settings + rules + hooks."
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
    ├─ mkdir -p .claude/rules/ → copy 11 rules
    ├─ Backfill: ensure .claude/CLAUDE.md has @rules/ references
    └─ Output rules install report
    │
Phase 6: Install Hooks (unless --no-hooks or --lite)
    │
    ├─ Locate plugin hooks dir (3-level fallback)
    ├─ mkdir -p .claude/hooks/ → copy 4 hooks + chmod +x
    ├─ Merge hook definitions into .claude/settings.json
    └─ Output hooks install report
    │
Phase 7: Final Verification Report
    │
    ├─ Summarize all phases
    ├─ Closed-loop check (CLAUDE.md + rules + hooks)
    └─ Output next steps
```

### Flag Short-Circuit Semantics

| Flag | Phase 1-2 | Phase 3-4 | Phase 5-6 | Phase 7 |
|------|-----------|-----------|-----------|---------|
| (none) | Execute | Execute | Execute | Full report |
| `--detect-only` | Execute | Skip | Skip | Detection results only |
| `--lite` | Execute | Execute | Skip | CLAUDE.md only |
| `--no-rules` | Execute | Execute | Skip rules | Report |
| `--no-hooks` | Execute | Execute | Skip hooks | Report |
| `--guard-mode warn` | Execute | Execute | Execute (stop-guard uses warn) | Report |

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
2. Copy all 11 rules:

   | Rule | Purpose |
   |------|---------|
   | `auto-loop.md` | Auto review loop enforcement |
   | `codex-invocation.md` | Codex independent research requirement |
   | `fix-all-issues.md` | Zero tolerance for unfixed issues |
   | `framework.md` | Framework conventions |
   | `testing.md` | Test structure and requirements |
   | `security.md` | OWASP security checklist |
   | `git-workflow.md` | Git branch and commit conventions |
   | `logging.md` | Structured logging standards |
   | `docs-writing.md` | Documentation writing conventions |
   | `docs-numbering.md` | Document numbering scheme |
   | `self-improvement.md` | Self-improvement loop |

3. Conflict strategy:

   | Scenario | Action |
   |----------|--------|
   | File does not exist | **Install** |
   | File exists, content identical | **Skip** |
   | File exists, content differs | **Skip** + warn as conflict |

### 5.3 Backfill CLAUDE.md (Closed-Loop Guarantee)

Ensure `.claude/CLAUDE.md` contains `@rules/` references so the auto-loop engine can activate:

1. Grep `.claude/CLAUDE.md` for `@rules/auto-loop.md`
2. **Found** → skip (already configured)
3. **Not found but file exists** → append `## Rules` block at end of file (11 `@rules/` references, content from `CLAUDE.template.md` L288-300)
4. **File does not exist** (edge case: Phase 3 was skipped) → extract from `CLAUDE.template.md`: L1-33 (Required Checks + Auto-Loop Rule) + L288-300 (Rules references) → create minimal `.claude/CLAUDE.md`

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
   ⛔ Hook source not found. Auto-loop enforcement layer cannot be installed.

   Remediation (choose one):
   1. Install the plugin: /plugin marketplace add sd0xdev/sd0x-dev-flow && /plugin install sd0x-dev-flow@sd0xdev-marketplace
   2. Copy hooks manually from a machine that has the plugin installed
   3. Re-run with --no-hooks to skip (enforcement layer will be missing)
   ```

   Then skip Phase 6 and continue to Phase 7. Phase 7 will report this as `⚠️ Partial`.

### 6.2 Copy Hook Scripts

1. `mkdir -p ${REPO_ROOT}/.claude/hooks/`
2. Copy 4 hooks (exclude `namespace-hint.sh` — plugin-only):

   | Hook | Event | Purpose |
   |------|-------|---------|
   | `pre-edit-guard.sh` | PreToolUse | Block editing .env/.git |
   | `post-edit-format.sh` | PostToolUse | Auto-format + track changes |
   | `post-tool-review-state.sh` | PostToolUse | Parse review results |
   | `stop-guard.sh` | Stop | Check review + precommit completed |

3. `chmod +x` each installed script.
4. Conflict strategy: same as Phase 5.2.

### 6.3 Merge Hook Definitions into Settings

Target: `${REPO_ROOT}/.claude/settings.json`

Hook definition mapping (uses `$CLAUDE_PROJECT_DIR` for portability):

```json
{
  "hooks": {
    "PreToolUse": [
      {"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/pre-edit-guard.sh"}]}
    ],
    "PostToolUse": [
      {"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-edit-format.sh"}]},
      {"matcher": "Bash|mcp__codex__codex|mcp__codex__codex-reply", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-tool-review-state.sh"}]}
    ],
    "Stop": [
      {"matcher": "", "hooks": [{"type": "command", "command": "STOP_GUARD_MODE=<MODE> \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/stop-guard.sh"}]}
    ]
  }
}
```

Where `<MODE>` = `strict` (default) or `warn` (when `--guard-mode warn` is specified).

> **Default strict mode**: `/project-setup` installs stop-guard in `strict` mode (blocks stop before review completes). Use `--guard-mode warn` to install in warn-only mode. The script itself defaults to `warn` when invoked without the environment variable.

Merge strategy:
- Read existing settings file (create `{}` if not exists)
- **Legacy migration**: scan for bare `.claude/hooks/<name>.sh` paths → upgrade to `"$CLAUDE_PROJECT_DIR"/.claude/hooks/<name>.sh`
- For each event: append-only merge (skip if same command path exists)
- **Stop hook mode merge**: when an existing Stop entry references `stop-guard.sh` but has a different `STOP_GUARD_MODE`, `/project-setup` **always replaces** the entry to match the requested mode (deterministic — no `--force` needed since `/project-setup` is an opinionated setup tool)
- Write updated settings back

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

## Phase 7: Final Verification Report

Summarize all phases and perform closed-loop check:

### Closed-Loop Check

| Condition | Check | Required |
|-----------|-------|----------|
| CLAUDE.md behavior text | `Required Checks` section exists | ✅ |
| `@rules/` references | `@rules/auto-loop.md` in `.claude/CLAUDE.md` | ✅ |
| Rule files | `.claude/rules/auto-loop.md` exists | ✅ |
| Hook enforcement | `stop-guard` in `.claude/settings.json` | ✅ |
| Guard mode | Stop hook command contains `STOP_GUARD_MODE=strict` | ✅ (unless `--guard-mode warn`) |

### Output

```markdown
## Project Setup Complete

| Phase | Status |
|-------|--------|
| Detection | ✅ Framework: X, PM: Y, DB: Z |
| CLAUDE.md | ✅ Configured (0 remaining placeholders) |
| Rules | ✅ 11/11 installed |
| Hooks | ✅ 4/4 installed + settings merged |

### Closed-Loop Status
✅ Auto-loop engine fully configured (strict mode)
(or ⚠️ Auto-loop engine configured (warn mode — stop-guard will not block))
(or ⚠️ Partial — missing: hooks (enforcement layer inactive))
(or ⚠️ Partial — missing: rules)

### Next Steps
- Run `/repo-intake` for a full project scan
- Use `HOOK_BYPASS=1` as emergency escape hatch
- Use `/install-rules --force` to upgrade rules later
```

## Verification

- [ ] All 9 auto-detected placeholders detected or marked N/A
- [ ] User confirmed detection results before writing
- [ ] No remaining auto-detected `{UPPER_CASE}` placeholders in `.claude/CLAUDE.md` after setup (manual placeholders like `{TICKET_PATTERN}` are acceptable)
- [ ] `.claude/rules/` contains 11 `.md` files (unless `--no-rules` or `--lite`)
- [ ] `.claude/hooks/` contains 4 `.sh` files with execute permission (unless `--no-hooks` or `--lite`)
- [ ] `.claude/settings.json` contains hook definitions (unless `--no-hooks` or `--lite`)
- [ ] `.claude/CLAUDE.md` contains `@rules/auto-loop.md` reference (unless `--lite`)

## References

See detection rules: [detection-rules.md](./references/detection-rules.md)
