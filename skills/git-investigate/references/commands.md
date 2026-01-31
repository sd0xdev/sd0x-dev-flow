# Git Investigation Commands

## Locate Author

```bash
# View line author
git blame -L 120,130 src/service/xxx.ts

# Show more context
git blame -L 120,130 -C -C src/service/xxx.ts
```

## Search Changes

```bash
# Search code additions/deletions
git log -p --all -S "keyword" -- "*.ts" | head -150

# Search commit messages
git log --grep="keyword" --oneline

# Track file history
git log --oneline --follow -- src/service/xxx.ts
```

## View Details

```bash
# Show commit info
git show abc123 --stat

# View file at specific commit
git show abc123:src/service/xxx.ts

# Compare versions
git diff abc123..def456 -- src/service/xxx.ts
```

## Find Deleted Code

```bash
# Find commit that deleted code
git log -p --all -S "deleted_code" -- "*.ts"
```

## Find PR Info

```bash
# From commit message (#123)
gh pr view 123
```

## Cross Reference

```bash
# Related changes in same period
git log --since="2024-01-01" --until="2024-01-31" --oneline -- src/service/
```

## Common Problem Patterns

| Pattern          | Symptom              | Root Cause                    |
| ---------------- | -------------------- | ----------------------------- |
| Type Removed     | Enum value deleted   | Assumed no longer needed      |
| Condition        | If conditions reduced| Missed during refactoring     |
| Rename           | Partially unchanged  | Incomplete search-and-replace |
| Boundary         | Only handles main flow| Edge cases not considered    |
| Merge            | Code anomaly         | Conflict resolution error     |

## Output Template

```markdown
# Code Investigation Report

## Investigation Target

- File: `<file>`
- Scope: `<lines or function>`

## Author Info

| Role              | Author | Date       | Commit |
| ----------------- | ------ | ---------- | ------ |
| Original author   | @xxx   | yyyy-mm-dd | abc123 |
| Issue introduced  | @yyy   | yyyy-mm-dd | def456 |

## Change Timeline

| Date | Commit | PR  | Change Description |
| ---- | ------ | --- | ------------------ |

## Original Code

\`\`\`typescript
// <commit>
<original code>
\`\`\`

## Problematic Code

\`\`\`typescript
// <commit>
<problematic code>
\`\`\`

## Root Cause Analysis

<analysis>

## Recommended Fix

<fix direction>
```
