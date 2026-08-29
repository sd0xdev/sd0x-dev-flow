# Scope Discipline Rule

**Scope is an axis orthogonal to severity.** Severity says how bad a finding is; scope says whether
this task owes it a fix. A defect introduced by this branch is fixed under zero tolerance
(@rules/fix-all-issues.md); a pre-existing defect outside the change's reach gets a recorded exit
instead of expanding a one-file change into a repo-wide sweep. Baseline tier: **Default**
(@rules/discretion.md) — deviate with a `[DEVIATION]` line naming a fact signal.

## Resident Guard

1. **The baseline is frozen.** It is computed once, at the first review round of the task, and no
   path recomputes it. The only update is an explicit user scope expansion.
2. **In-scope — any one of**: the file is in the baseline set; the defect sits on a call path the
   baseline diff directly touches (**one hop**, cited `file:line`); the defect was introduced by
   this branch (`git log -L` / `git blame`).
3. **`uncertain` fails closed to in-scope.** Declaring out-of-scope needs **complete negative
   evidence** — all three conditions individually shown false. Any missing negative ⇒ `uncertain`.
4. **No repo-wide helper sweep.** A helper created for an in-scope fix is applied to scope-hit files
   only. Updating the **direct callers** of a signature this branch changed is one hop, and in scope.
5. **Out-of-scope ∧ critical** (P0 / security / data-integrity), with no valid `[USER_SKIPPED]`
   covering it → the gate reads `⛔ Blocked`, the model does **not** enter the fix loop, and no
   pass is noted: human exit E1. Out-of-scope ∧ non-critical → recorded and deferred; it does
   **not** block `✅ Ready`. A breaker-triggered in-scope blocking finding is the other enumerated
   exit, E2 — both are defined in the contract.
6. **Anchor compatibility.** Scope decides which findings demand a fix — it **never** exempts an
   edit from re-review: an edit moves the digest, re-opens the plane, and the reviewer re-runs
   (Register #6) — there is no user exception to that. Expansion into security/data-integrity
   files is reviewed at `thorough` (Register #3). Records never carry secrets (Register #2). A
   finding whose content hits
   `rules/security.md` takes Register #1 precedence over any skip. These are inherited hits: they
   resolve at step 0 and **are not new Register items**.

Records — emitted at column 0, field order fixed, greppable; a reporting convention, nothing parses
them:

```
[OUT_OF_SCOPE_DEFERRED] file:line | issue | suggested-ticket | <ISO8601>
[USER_SKIPPED] key=<file|canonical_issue> | authorized_at=<ISO8601> | scope=<task-id>
```

## Load the full contract when

A finding or an edit falls outside the frozen baseline · scope is `uncertain` · a review round is
being dispatched or its gate derived · the circuit breaker may have tripped · an E1 disposition is
being created or validated.

→ `skills/codex-code-review/references/scope-contract.md` — baseline computation and the
`${BASE_BRANCH}` cascade, the full behavior table, `[USER_SKIPPED]` validity, the closed-set E1
options, the helper-sweep boundary, circuit-breaker counters and thresholds, the normalization-first
gate derivation (the routing matrix itself stays in the review skill's § Step 4.5), and the
enumerated human exits E1 and E2.
