---
name: install-hooks
description: "Install plugin hooks into project .claude/ for persistent use without plugin loaded"
allowed-tools: Read, Grep, Glob, Write, AskUserQuestion, Bash(mkdir:*), Bash(diff:*), Bash(git:*), Bash(ls:*), Bash(chmod:*), Bash(jq:*), Bash(node:*)
---

# Install Hooks

## Trigger

- Keywords: install hooks, setup hooks, copy hooks, install-hooks

## When NOT to Use

- Installing rules (use `/install-rules`)
- Installing scripts (use `/install-scripts`)
- Full project setup (use `/project-setup`)

## Workflow

```
Phase 0: Resolve mode; obsolete-set migration (first for non-list invocations; --dry-run forwarded)
Phase 1: Locate plugin hooks dir
Phase 2: Enumerate hook scripts
Phase 3: Determine install set (--all, specific names, or interactive)
Phase 4a: Copy scripts to .claude/hooks/
Phase 4b: Merge hook definitions into settings.json
Phase 4c: Update manifest
Phase 4.5: Backfill CLAUDE.md references
Phase 5: Output report
```

### Phase 0: Obsolete-Set Migration

**Resolve the invocation mode first** — Phase 0 mutates settings and deletes files, so the
non-mutating modes must never reach it live: with `--list`, skip Phase 0 entirely (listing is
read-only); with `--dry-run`, forward the flag so the migration also only reports:

```bash
# --list        → skip this phase
# --dry-run     → append --dry-run to the command below
node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-hook-lightweighting.js" --repo "$(git rev-parse --show-toplevel)"
```

Otherwise run the shared migration **before any copy or merge** — it is what removes the retired
enforcement-layer files and their registrations (hook-lightweighting § 3.6), and running it first
is what prevents the dangerous half-state (scripts-new + hooks-old).

Ordering inside the script is fixed: it deregisters settings entries first and deletes files only
after the settings writes succeed; a failed settings write aborts (exit 1) before any deletion.
On exit 1, **stop the install and surface the report** — installing on top of a repo whose
deregistration failed reproduces the half-state the migration exists to prevent. Modified obsolete
files are kept on disk (registration disabled) and named in the report; include those lines in
Phase 5's output.

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--all` | Install all available hooks |
| `--list` | List available hooks without installing |
| `--dry-run` | Show what would be installed, no changes |
| `--force` | Overwrite existing hooks with different content |
| `--local` | Write to settings.local.json instead of settings.json |
| `hook-names...` | Specific hooks to install |

### Two-Layer Install

| Layer | Target | Content |
|-------|--------|---------|
| Scripts | `.claude/hooks/*.sh` | Executable hook scripts |
| Definitions | `settings.json` hooks entries | Event → script path mapping |

**Script dependencies**: a locally installed hook resolves its helper scripts beside its own copy
(`.claude/scripts/…`), never from the plugin. The whole dependency surface is one checker —
`scripts/review-state.js` (which requires `scripts/lib/tree-digest.js`) — read by `stop-guard.sh`,
`user-prompt-review-guard.sh` and `post-compact-auto-loop.sh` (`post-skill-auto-loop.sh` is
deliberately zero-read: it prints one static gate-order line and consumes nothing). Missing →
every hook still runs and still reminds: it reports change-class facts from live git and **claims no
verdict** (nothing blocks — the hooks are reminders, hook-lightweighting § 3.2). Installing the
checker via `/install-scripts --all` (or `/project-setup`) is what upgrades the reminders from
"changed, verdict unknown" to "changed, reviewed at this tree".

### Conflict Handling

| Script Status | Settings Status | Action |
|---------------|----------------|--------|
| Missing | Missing | Install both |
| Identical | Present | Skip (up to date) |
| Different | Present | AskUserQuestion |

## Output

```markdown
## Install Hooks Report

| Hook | Script | Settings | Status |
|------|--------|----------|--------|
| post-edit-format | ✅ | ✅ | installed |
| stop-guard | ✅ | ⏭️ | skipped (identical) |

Scripts: N installed | Settings entries: M merged
```
