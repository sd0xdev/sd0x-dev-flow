---
name: codex-setup
description: "Initialize sd0x-dev-flow infrastructure for Codex CLI and other non-Claude agents. Generates AGENTS.md, installs git hooks, copies runner scripts. Use when setting up a new project or after updating skills."
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(node:*), Bash(git:*), Bash(ls:*), Bash(mkdir:*), Bash(cp:*), Bash(chmod:*), Bash(bash:*), Bash(cat:*), Bash(wc:*)
---

# Codex Setup

## Trigger

- Keywords: codex setup, codex init, agents.md, setup codex, initialize codex, codex doctor, codex sync
- After: `npx skills add sd0xdev/sd0x-dev-flow`

## Subcommands

| Command | Purpose |
|---------|---------|
| `init` | First-time setup: generate AGENTS.md + install hooks + copy scripts |
| `doctor` | Verify installation integrity (files exist + hash match) |
| `sync` | Re-generate AGENTS.md + update hooks/scripts after skill update |

Default (no subcommand): `init`

## init

### Phase 1: Detect Host Context

1. Find repo root: `git rev-parse --show-toplevel`
2. Read `package.json` if present → extract `name`, `scripts.test`
3. Read `.claude/CLAUDE.md` or `CLAUDE.md` → extract test command pattern
4. Detect plugin root: find `scripts/build-codex-artifacts.js` relative to this skill

### Phase 2: Generate AGENTS.md Kernel

```bash
node <plugin-root>/scripts/build-codex-artifacts.js \
  --project-dir <repo-root> \
  --output <repo-root>/AGENTS.md
```

If the file already exists, warn and ask before overwriting.

Verify output:
- File exists and is non-empty
- Size ≤ 24 KiB (`wc -c < AGENTS.md` ≤ 24576)
- No unresolved placeholders (`{PROJECT_NAME}`, `{VERSION}`, `{TEST_COMMAND}`)

### Phase 3: Multi-Mode Hook Install

Install `commit-msg` and `pre-push` git hooks using priority-ordered detection:

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | `.husky/` directory exists | Append sourcing to Husky hooks |
| 2 | `git config core.hooksPath` is set | Install to that path |
| 3 | `.git/hooks/` is writable | Direct write |
| 4 | Fallback | Write to `.githooks/` + print `git config core.hooksPath .githooks` |

Source scripts from plugin:
- `commit-msg-guard.sh` → `commit-msg` hook
- `pre-push-gate.sh` → `pre-push` hook

### Phase 4: Copy Runner Scripts

Copy these scripts to the host project:

| Source | Target |
|--------|--------|
| `scripts/precommit-runner.js` | `.sd0x/scripts/precommit-runner.js` |
| `scripts/verify-runner.js` | `.sd0x/scripts/verify-runner.js` |
| `scripts/lib/utils.js` | `.sd0x/scripts/lib/utils.js` |
| `scripts/lib/tree-digest.js` | `.sd0x/scripts/lib/tree-digest.js` |
| `scripts/lib/receipt-log.js` | `.sd0x/scripts/lib/receipt-log.js` |

Ensure target directories exist (`mkdir -p`).

### Phase 5: Write State File

Write `.sd0x/install-state.json` to repo root:

```json
{
  "sd0x_version": "<from plugin.json>",
  "agents_md_hash": "<git hash-object AGENTS.md>",
  "agents_md_size": <bytes>,
  "hooks_installed": {
    "commit-msg": { "hash": "<sha1>", "mode": "<husky|hooksPath|direct|fallback>" },
    "pre-push": { "hash": "<sha1>", "mode": "<mode>" }
  },
  "scripts_installed": {
    "precommit-runner.js": "<sha1>",
    "verify-runner.js": "<sha1>",
    "lib/utils.js": "<sha1>",
    "lib/tree-digest.js": "<sha1>",
    "lib/receipt-log.js": "<sha1>"
  },
  "generated_at": "<ISO8601>"
}
```

### Sandbox Adaptation

| Codex sandbox | Behavior |
|---------------|----------|
| `workspace-write` / `danger-full-access` | Execute all phases automatically |
| `read-only` | Output command list for manual execution |

Detect sandbox: if `mkdir -p` or file write fails, switch to read-only output mode.

## doctor

### Checks

| Check | Method | Pass | Fail |
|-------|--------|------|------|
| AGENTS.md exists | `test -f AGENTS.md` | File found | Missing |
| AGENTS.md hash match | Compare `git hash-object` vs state file | Match | Drift detected |
| AGENTS.md size ≤ 24 KiB | `wc -c` | ≤ 24576 | Oversized |
| Hooks installed | Check hook files exist in detected mode | Present | Missing |
| Scripts installed | Check `.sd0x/scripts/` files exist | Present | Missing |
| Version match | Compare state `sd0x_version` vs current plugin | Match | Update available |

Output a summary table with pass/fail status for each check.

## sync

1. Re-run `build-codex-artifacts.js` → overwrite AGENTS.md
2. Re-copy hook scripts (overwrite if changed)
3. Re-copy runner scripts (overwrite if changed)
4. Update `.sd0x/install-state.json` with new hashes

## References

- `references/agents-kernel.md` — AGENTS.md kernel template
