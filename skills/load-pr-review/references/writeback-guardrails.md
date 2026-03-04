# Writeback Guardrails — Load PR Review

## Core Safety Rules

| Rule | Enforcement |
|------|-------------|
| Dry-run first | `writeback --plan` must run before `--execute` |
| User gate | AskUserQuestion required before any write operation |
| One-at-a-time | `--execute` processes one thread per invocation |
| Failure isolation | Single thread failure does not abort remaining threads |

## Reply Target Validation

Reply target must be the **first comment's `databaseId`** in the thread (the `replyTargetId` field).

| Condition | Action |
|-----------|--------|
| `replyTargetId` present | Proceed with reply |
| `replyTargetId` missing | Degrade to plan-only, warn user |
| `replyTargetId` is not a number | Exit 2: invalid target |

## Body Transmission (Shell Injection Prevention)

Always use `jq` + `--input -` to construct and pass JSON body:

```bash
jq -n --arg body "$REPLY" '{body:$body}' | \
  gh api --method POST \
    repos/{owner}/{repo}/pulls/{pr}/comments/{replyTargetId}/replies \
    --input -
```

**Prohibited patterns:**

```bash
# Never interpolate reply body directly into shell arguments
gh api ... -f body="$REPLY"        # shell expansion risk
gh api ... --raw-field body=$REPLY  # unquoted risk
```

## Resolve Thread Mutation

```bash
gh api graphql -f query='
  mutation($id: ID!) {
    resolveReviewThread(input: {threadId: $id}) {
      thread { isResolved }
    }
  }
' -F id='PRRT_xxx'
```

## Writeback Plan Format

```markdown
| # | Thread | File | Action | Reply Preview |
|---|--------|------|--------|---------------|
| 1 | PRRT_a | src/foo.ts:42 | Reply + Resolve | "Fixed in abc123" |
| 2 | PRRT_b | src/bar.ts:15 | Reply only | "By design because..." |
```

## Error Handling

| Error | Exit | Recovery |
|-------|------|----------|
| Reply API fails | 1 (warn) | Report, continue to next thread |
| Resolve mutation fails | 1 (warn) | Reply succeeded, resolve skipped |
| No `replyTargetId` | 2 (error) | Cannot writeback, plan-only |
| Network error | 2 (error) | Abort, report |
