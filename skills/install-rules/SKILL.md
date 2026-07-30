---
name: install-rules
description: "Install plugin rules into project .claude/rules/ for persistent use without plugin loaded"
allowed-tools: Read, Grep, Glob, Write, AskUserQuestion, Bash(mkdir:*), Bash(diff:*), Bash(git:*), Bash(ls:*)
---

# Install Rules

## Trigger

- Keywords: install rules, setup rules, copy rules, install-rules

## When NOT to Use

- Installing hooks (use `/install-hooks`)
- Installing scripts (use `/install-scripts`)
- Full project setup (use `/project-setup`)

## Workflow

```
Phase 1: Locate plugin rules dir
Phase 2: Enumerate *.md, MINUS the override templates (*-project.md) — see below
Phase 3: Determine install set (--all, specific names, or interactive)
Phase 3.5: Read manifest + classify (new/unchanged/modified/conflict)
Phase 4: Install (smart merge with manifest tracking)
Phase 4.5: Override templates — copy-when-absent only (never smart-merged)
Phase 4.6: Backfill CLAUDE.md references
Phase 5: Output report
```

**Managed-set exclusion (required)**: `*-project.md` files are user-owned and must be excluded from the Phase 2 enumeration, so they never enter the manifest, the classification in Phase 3.5, or the smart merge in Phase 4. They are handled only by Phase 4.5 below. Routing them through the managed path would let `--force`, a conflict resolution, or an auto-upgrade rewrite a file the user owns.

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--all` | Install all available rules |
| `--list` | List available rules without installing |
| `--dry-run` | Show what would be installed, no changes |
| `--force` | Overwrite modified rules |
| `--legacy-strategy <strategy>` | Handle pre-manifest installs (ask/overwrite/skip) |
| `--customize <rule>` | Customize a project-override rule |
| `rule-names...` | Specific rules to install |

### Manifest Tracking

Uses `.sd0x/install-state.json` to track installed file hashes. Smart merge logic:

| Status | Action |
|--------|--------|
| New (not installed) | Copy |
| Unchanged (hash match) | Auto-upgrade |
| Modified by user | Skip (preserve edits) |
| Conflict (both changed) | AskUserQuestion |

### Customize Mode (`--customize`)

Manages `*-project.md` companion files for user overrides:

| Sub-flag | Action |
|----------|--------|
| (none) | Show section status |
| `--add-section` | Add a new section |
| `--update-section <name>` | Update specific section |
| `--reset` | Regenerate from template |

### Override Template Copy Contract (R8)

Both override templates are copied from `rules/` on install when absent (`override_templates` in `docs/features/rule-override-pattern/2-tech-spec.md` maps `auto-loop.md → auto-loop-project.md` and `testing.md → testing-project.md`). This is the **only install or re-install path** that writes them — they are excluded from the managed set above, so no merge, upgrade, or `--force` reaches them. (The one other writer is the user-invoked `--reset`, below.)

The copy and `--reset` regeneration produce the **live-precedence header** (a live `Precedence:` paragraph before the first `##` — HTML comments are stripped from model context, so a comment-form declaration never reaches the model), and stamp `<!-- Based on: <base> @ <hash> -->` with the base rule's blob hash **at copy time** rather than carrying the template's recorded value, so a fresh install starts at zero drift instead of inheriting whatever hash the shipped template happened to record.

An already-installed `.claude/rules/*-project.md` is user-owned and is **never rewritten by install or re-install** — including `--force`, which governs the managed set only. The single exception is `--customize <rule> --reset`, which the user invokes explicitly against a named file to regenerate it; that is a requested overwrite, not an install-time one. A legacy comment-only header is therefore *reported* by `/claude-health` S2.5 check #6 and never migrated on the user's behalf — `--reset` is offered as the remedy the user may choose, not an action the install path takes.

## Output

```markdown
## Install Rules Report

| Rule | Status | Action |
|------|--------|--------|
| auto-loop.md | unchanged | auto-upgraded |
| testing.md | user-modified | skipped |

Installed: N | Skipped: M | Conflicts: K
```
