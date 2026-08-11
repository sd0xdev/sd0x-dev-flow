# .claude/ Best Practices

## Directory Structure Standard

```
.claude/
├── .gitignore              # Must exist
├── settings.json           # Team shared config (checked in)
├── settings.local.json     # Personal config (git-ignored)
├── README.md               # Workflow documentation
├── agents/                 # Subagent role definitions
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
| Skill file | SKILL.md + references/ | `skills/<name>/SKILL.md` |
| Rule file | kebab-case.md | `auto-loop.md` |
| Reference dir | `references/` (plural) | `skills/x/references/` |
| Script file | kebab-case.js/sh | `verify-runner.js` |

## Skill Entry Point Rules

| Skill Type | Structure | Notes |
|------------|-----------|-------|
| Workflow skill | `skills/<name>/SKILL.md` | `feature-dev`, `bug-fix`, etc. |
| Review skill | `skills/<name>/SKILL.md` | `codex-code-review`, etc. |
| Domain KB | `skills/<name>/SKILL.md` | `portfolio`, `aum` — referenced by other skills |
| External | N/A | `agent-browser` — not maintained here |
| Tool skill | `skills/<name>/SKILL.md` | `git-worktree`, `skill-creator` (external), etc. |

## Governance Limits

| Metric | Suggested Limit | When Exceeded |
|--------|-----------------|---------------|
| Skills | 50 | Consider grouping or merging similar |
| Agents | 20 | Ensure each has distinct role |
| Rules | 15 | Merge related rules |
| Cache | 50MB | Clean old cache |
