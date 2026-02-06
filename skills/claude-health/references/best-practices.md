# .claude/ Best Practices

## Directory Structure Standard

```
.claude/
├── .gitignore              # Must exist
├── settings.json           # Team shared config (checked in)
├── settings.local.json     # Personal config (git-ignored)
├── README.md               # Workflow documentation
├── agents/                 # Subagent role definitions
├── commands/               # Slash command entry points
├── rules/                  # Auto-loaded rules
├── skills/                 # On-demand knowledge bases
│   └── {name}/
│       ├── SKILL.md        # Main file
│       ├── references/     # Reference materials (plural!)
│       ├── templates/      # Output templates
│       └── scripts/        # Executable scripts
├── hooks/                  # Lifecycle hooks
├── scripts/                # Shared execution scripts
└── cache/                  # Runtime cache (git-ignored)
```

## .gitignore Required Items

```gitignore
.DS_Store
settings.local.json
cache/
.tmp*
*.tmp
*.zip
.claude_review_state.json
```

## Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Skill directory | kebab-case | `code-explore/` |
| Command file | kebab-case.md | `codex-review-fast.md` |
| Rule file | kebab-case.md | `auto-loop.md` |
| Reference dir | `references/` (plural) | `skills/x/references/` |
| Script file | kebab-case.js/sh | `verify-runner.js` |

## Command-Skill Pairing Rules

| Skill Type | Needs Command? | Notes |
|------------|----------------|-------|
| Workflow skill | ✅ Required | `feature-dev`, `bug-fix`, etc. |
| Review skill | ✅ Required | `codex-code-review`, etc. |
| Domain KB | ❌ Not needed | `portfolio`, `aum` — referenced by other skills |
| External | ❌ Not needed | `agent-browser` — not maintained here |
| Tool skill | ✅ Recommended | `git-worktree`, `create-skill`, etc. |

## Governance Limits

| Metric | Suggested Limit | When Exceeded |
|--------|-----------------|---------------|
| Commands | 50 | Consider grouping or merging similar |
| Skills | 30 | Check for overlap |
| Agents | 20 | Ensure each has distinct role |
| Rules | 15 | Merge related rules |
| Cache | 50MB | Clean old cache |
