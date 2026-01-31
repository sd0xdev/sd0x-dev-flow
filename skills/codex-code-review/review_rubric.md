# Review Rubric

## Severity

| Level | Definition                                        | Examples                   |
| ----- | ------------------------------------------------- | -------------------------- |
| P0    | Security vulnerability, data corruption, core unavailable | SQLi, auth bypass     |
| P1    | Correctness risk, performance regression, test gap | Race condition, N+1       |
| P2    | Design flaw, maintainability issue                | Deep nesting               |
| Nit   | Style, naming                                     | Variable naming            |

## Merge Gate

| Gate      | Condition                              |
| --------- | -------------------------------------- |
| Ready     | No P0, P1 fixed or has mitigation      |
| Blocked   | Has P0, or checks failing              |
