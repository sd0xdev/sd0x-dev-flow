# Fix All Issues Rule ⚠️ CRITICAL

**Fix every issue found, no skipping allowed**

## Core Principles

| Principle          | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| **Zero tolerance** | Every discovered issue must be fixed                               |
| **No skipping**    | Cannot skip with excuses like "unrelated", "no impact", "fix later"|
| **Find root cause**| Don't just fix the surface; find the root cause                    |
| **Fix immediately**| Fix the moment it's found; don't defer                             |

## Applicable Scenarios

| Scenario                       | Action         |
| ------------------------------ | -------------- |
| Issue found during development | ✅ Fix now     |
| Test failure discovered        | ✅ Fix now     |
| Lint/TypeCheck errors          | ✅ Fix now     |
| Code Review flagged issue      | ✅ Fix now     |
| Issue noticed in passing       | ✅ Fix now     |
| "Unrelated" issue              | ✅ Fix now     |

## Prohibited Behaviors

```
❌ "This issue is unrelated to the current task, skipping"
❌ "This is a pre-existing issue, not handling"
❌ "This error doesn't affect the main flow"
❌ "Fix it later"
❌ "Known issue, ignoring"
```

## Correct Behaviors

```
✅ "Found issue X, fixing..."
✅ "Test failed, analyzing cause: Y, fixing..."
✅ "Also found error Z, fixing it as well"
✅ "Lint reported 3 errors, fixing all"
```

## Root Cause Analysis Requirements

When fixing, must answer:

1. **What** — The specific symptom of the issue
2. **Why** — The root cause (not the surface cause)
3. **How to fix** — The fix approach
4. **Prevent recurrence** — How to avoid the same type of issue

## Exceptions (Only)

| Exception                  | Condition                                           |
| -------------------------- | --------------------------------------------------- |
| User explicitly asks to skip | User says "don't worry about this"                |
| Beyond current scope       | Requires architecture-level changes; report and log |
| Third-party library issue  | Cannot modify; document workaround                  |

## Relationship to Other Rules

This rule takes priority over task scope constraints:

```
Issue found -> Fix -> Continue original task
              ↑
    Don't ask "should I fix it?"
    Don't say "unrelated to the task"
```
