# Obsidian CLI Integration Patterns

## Development Workflow Integration

### Pattern 1: Session Bookends

Capture session context at start and end of a coding session.

```
Session start:
  /obsidian-cli context --query "current sprint tasks"
  → Pull relevant vault context into Claude

Session end:
  /obsidian-cli daily --text "- Completed auth middleware refactor (PR #42)"
  /obsidian-cli task --add "Follow up: add rate limiting tests"
```

### Pattern 2: Decision Capture

After architecture decisions or trade-off discussions, persist to vault.

```
After /codex-brainstorm or /deep-analyze:
  /obsidian-cli capture --file "decisions/YYYY-MM-DD-<topic>.md" --text "<decision summary>"
```

### Pattern 3: Debug Journal

When investigating complex bugs, capture findings incrementally.

```
During /bug-fix or /code-investigate:
  /obsidian-cli daily --text "## Debug: <issue>\n- Found: <finding>\n- Root cause: <cause>"
```

### Pattern 4: Knowledge Retrieval

Before implementing a feature, search vault for prior art.

```
Before /feature-dev:
  /obsidian-cli context --query "<feature keywords>"
  → Check if similar work was done before, reuse patterns
```

## Metadata Convention

When capturing notes, include dev context:

```markdown
---
repo: <repo-name>
branch: <current-branch>
date: <YYYY-MM-DD>
type: decision|debug|meeting|spec
---
```

## Vault Organization Suggestion

```
vault/
├── daily/          ← daily notes (auto-managed by Obsidian)
├── dev/
│   ├── decisions/  ← architecture decision records
│   ├── debug/      ← debug session journals
│   └── specs/      ← tech specs captured from Claude
├── tasks/          ← task tracking
└── references/     ← reference material
```
