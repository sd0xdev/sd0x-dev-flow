# API Contract — Load PR Review

## GraphQL Query (Primary)

```graphql
query ($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      title
      number
      url
      headRefName
      baseRefName
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          diffSide
          comments(first: 20) {
            nodes {
              id
              databaseId
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}
```

### Pagination

| Setting | Value | Note |
|---------|-------|------|
| `first` (threads) | 100 | v1 hard cap |
| `first` (comments per thread) | 20 | Sufficient for review conversations |
| Cursor | `$cursor` / `pageInfo.endCursor` | v1: single page; v2: auto-paginate |

If `hasNextPage` is true, emit warning: `100+ threads detected, showing first 100`.

## REST Fallback

When GraphQL fails (auth/permission/network):

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
```

### REST Limitations

| Feature | GraphQL | REST |
|---------|---------|------|
| `isResolved` | Yes | No |
| Thread grouping | Native (`reviewThreads`) | Manual (group by `path` + `original_position`) |
| `isOutdated` | Yes | Heuristic (`position === null`) |
| `diffSide` | Yes | `side` field |

### Degraded Banner

When REST fallback activates:

```
REST fallback: thread resolution status unknown, showing all comments
```

## Metadata Fetch

```bash
gh pr view <N> --json number,title,url,headRefName,baseRefName,state,reviewDecision
```

### Preflight Checks

| Check | Fail Action |
|-------|-------------|
| PR exists | Exit 2: "PR not found" |
| PR is open | Warn: "PR is closed/merged, showing historical reviews" |
