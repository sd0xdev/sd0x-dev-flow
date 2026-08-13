# Stop Hook — Owed-Gate Reminder

Since hook-lightweighting (2026-08-13) the Stop hook is a **reminder, not a gate**: it prints
which gates the reminder state still shows as owed and **always exits 0**. Nothing blocks a stop.

## How It Works

The script `stop-guard.sh` will:

1. Ask the checker (`node scripts/review-state.js check --format=md`; installed projects resolve
   `.claude/scripts/review-state.js` first) which planes are owed
2. Print one reminder line per owed plane (plane, suggested gate, `rounds` when > 0)
3. Fall back to plain git facts when the checker is unavailable — it reports change-class facts
   and claims no verdict
4. **Exit 0 on every path** — there is no exit 2, no transcript parsing, no pass-marker scanning

## What "owed" means

One state slot per plane under `~/.cache/sd0x-dev-flow/state/<repo-key>/`, written only by
`node scripts/review-state.js note <plane> <pass|fail>`:

| Plane | Suggested gate |
|-------|----------------|
| `code_review` | `/codex-review-fast` |
| `doc_review` | `/codex-review-doc` |
| `precommit` | `/precommit` |

A plane is owed when it is dirty and not passed; `passed ⇔ noted ∧ digest match ∧ verdict pass`,
so an edit re-opens its plane's reminder because the digest changed. The reminder falls silent the
honest way — run the gate, note the verdict.

## What binds instead

The behaviour layer: the terminal completion invariant and gate sentinels in
`rules/auto-loop.md`. The hook restates those obligations as facts; it never decides them.
Contract and mechanics: `docs/features/hook-lightweighting/2-tech-spec.md` §3.

Comment-only edits are still conservatively classified as code: comments can carry
compiler/lint/build directives, and no semantic-inertness classifier exists, so an edit to a code
file re-opens the code planes even when only comments changed.
