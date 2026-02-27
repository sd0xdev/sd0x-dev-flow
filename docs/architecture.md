# Architecture Deep Dive

> This document covers advanced architectural details. For general usage, see [README.md](../README.md).

## Agentic Control Stack

This plugin implements a complete agentic control loop architecture. Each layer maps to specific plugin components:

| Layer | sd0x-dev-flow Implementation | Key Files |
|-------|------------------------------|-----------|
| **Feedforward Gate** | `/precommit` hooks, `pre-edit-guard.sh`, lint:fix | `hooks/pre-edit-guard.sh`, `commands/precommit.md` |
| **Feedback Loop (MAPE)** | `/verify` → `/codex-review-fast` → fix → re-review | `rules/auto-loop.md` |
| **Hierarchical Loops** | Inner (hooks 30s) → Mid (review+precommit 10min) → Outer (PR review + rules) | `hooks/` → `commands/` → `rules/` |
| **Sensors** | `audit.js`, `analyze.js`, `risk-analyze.js`, `skill-lint.js` | `skills/*/scripts/*.js` |
| **Effectors** | Edit/Write tools, allowed-tools whitelist, diff budget | `commands/*.md` frontmatter |
| **Human Governance** | `rules/` = Knowledge curation, `⚠️ Need Human` sentinel = circuit breaker | `rules/auto-loop.md` |

### Control Loop Pathology & Mitigation

| Failure Mode | Symptom | Mitigation in sd0x-dev-flow |
|--------------|---------|----------------------------|
| **Oscillation** | Fix test1 breaks test2, revert loops | 3-round limit on same issue → report blocker, request human |
| **Local Minimum** | Tests pass via hacks (deleted assertions) | Independent Codex review (never feed conclusions) as second sensor |
| **Divergence** | Diff grows unbounded, unrelated changes | `allowed-tools` whitelist limits effectors, git rules forbid direct push to main |

## Command Template Sandbox Rules

When writing `!` backtick context checks in command templates, be aware of Claude Code sandbox restrictions:

| Problem | Solution |
|---------|----------|
| `ls`/`find` on home-dir paths blocked in `!` context checks | Use `bash -c 'test -f "$HOME/..." && echo ok \|\| echo missing' 2>/dev/null \|\| echo "unknown (sandbox)"` |
| `allowed-tools` pattern must match `!` check commands | If `allowed-tools: Bash(bash:*)`, wrap all `!` checks in `bash -c '...'` |
| `${CLAUDE_PLUGIN_ROOT}` unavailable in command `.md` | Cannot narrow `allowed-tools` to specific script paths; keep `Bash(bash:*)` until [#9354](https://github.com/anthropics/claude-code/issues/9354) resolved |

## Script Fallback Pattern

Verification commands (`/precommit`, `/verify`, `/dep-audit`) use a **Try → Fallback** pattern:

1. **Try**: If a runner script exists in the project root (`scripts/precommit-runner.js`, etc.), use it for fast, deterministic execution.
2. **Fallback**: If no script is found, Claude detects the project ecosystem (Node.js, Python, Rust, Go, Java) and runs the appropriate commands directly.

The fallback works out of the box with no setup required. Runner scripts are bundled in this plugin repo but cannot be auto-resolved from plugin commands due to a [Claude Code limitation](https://github.com/anthropics/claude-code/issues/9354) (`${CLAUDE_PLUGIN_ROOT}` is unavailable in command markdown).
