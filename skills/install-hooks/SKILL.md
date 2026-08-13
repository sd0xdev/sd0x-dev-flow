---
name: install-hooks
description: "Install plugin hooks into project .claude/ for persistent use without plugin loaded"
allowed-tools: Read, Grep, Glob, Write, AskUserQuestion, Bash(mkdir:*), Bash(diff:*), Bash(git:*), Bash(ls:*), Bash(chmod:*), Bash(jq:*)
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
Phase 1: Locate plugin hooks dir
Phase 2: Enumerate hook scripts
Phase 3: Determine install set (--all, specific names, or interactive)
Phase 4a: Copy scripts to .claude/hooks/
Phase 4b: Merge hook definitions into settings.json
Phase 4c: Update manifest
Phase 4.5: Backfill CLAUDE.md references
Phase 5: Output report
```

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
| `--guard-mode warn\|strict` | Set stop-guard mode during install |
| `hook-names...` | Specific hooks to install |

### Two-Layer Install

| Layer | Target | Content |
|-------|--------|---------|
| Scripts | `.claude/hooks/*.sh` | Executable hook scripts |
| Definitions | `settings.json` hooks entries | Event → script path mapping |

**Script dependencies**: a locally installed hook resolves its helper scripts beside its own copy
(`.claude/scripts/…`), never from the plugin — and the two dependency families fail differently:

- **Derivation** — `lib/gate-derive.js`, read by `stop-guard.sh` and the auto-loop advisory hooks
  (`user-prompt-review-guard.sh`, `post-skill-auto-loop.sh`, `post-compact-auto-loop.sh`). Missing
  → the two families degrade **differently**, and only one of them reaches the mirror. Inside a
  repository `stop-guard.sh` runs its own direct `git status` probe and discloses
  `source=git_probe degraded=derive_unavailable`; it reads the mirror only where no derivation is
  possible at all (not a repository). The three advisory hooks do fall back to the mirror
  (`source=state_file`) — they are advisory, so a stale answer warns rather than decides.
- **Dispatch** — `dispatch-cli.js` and `lib/dispatch-log.js`, read by
  `post-tool-review-state.sh`, `stop-guard.sh` and `session-init.sh`. Missing →
  `post-tool-review-state.sh` **blocks review dispatches with `exit 2`** (an unrecorded review
  would be an orphan no sweep can account for — fail-closed, not a fallback), `stop-guard.sh`'s
  pairing sweep cannot run, and `session-init.sh` skips capture-time activation
  and dispatch-log compaction — lazy activation inside `appendDispatch()` is what would take
  over, but not while the dependency is missing: the `exit 2` above blocks every dispatch
  before it can reach that path, so lazy activation resumes only once the library is back —
  advisory, session start is never blocked; silently when `dispatch-cli.js` itself is absent,
  with stderr diagnostics when the CLI exists but fails to load a dependency.
  When only these two are missing, gate derivation is unaffected — the two paths are independent.
- **Shared** — `lib/tree-digest.js` and `lib/receipt-log.js` are required by **both** families
  (`gate-derive.js` and `dispatch-log.js` require both; `dispatch-cli.js` requires `tree-digest.js`
  directly and the rest via `dispatch-log.js`), so a missing shared library triggers both failure
  modes at once: mirror fallback *and* blocked review dispatches.

After installing hooks, run `/install-scripts --all` (or `/project-setup`, whose Phase 6.5 ships
the same set) so both paths actually run.

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
