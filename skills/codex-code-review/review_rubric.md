# Review Rubric

## Severity

| Level | Definition                                        | Examples                   |
| ----- | ------------------------------------------------- | -------------------------- |
| P0    | Security vulnerability, data corruption, core unavailable | SQLi, auth bypass     |
| P1    | Correctness risk, performance regression, test gap | Race condition, N+1       |
| P2    | Design flaw, maintainability issue                | Deep nesting               |
| Nit   | Style, naming                                     | Variable naming            |

## Merge Gate

Decided by the tier's blocking severity (`fast` P0 · `standard` P0/P1 · `thorough` P0/P1/P2). `standard` is the default.

| Gate      | Condition                              |
| --------- | -------------------------------------- |
| Ready     | No finding at or above the blocking severity — sub-threshold ones are logged, not swept |
| Blocked   | At least one such finding, needs fix   |

There is no batch-fix-then-re-review sweep before precommit. See `@rules/auto-loop.md` § Sub-Threshold Findings.
