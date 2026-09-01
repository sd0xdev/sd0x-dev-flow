# Intent — request-ordering

> **Doc class**: Intent (ancillary — Design record). Written by the planner, checked by the
> implementer. Work that contradicts an Invariant or Non-goal stops and asks — amending this
> file is a re-decision, not a sync.

## North star

Under a large multi-ticket task the model must pick the *right next ticket* — urgent-and-ready
work first, then finishing started work — instead of drifting to important-but-not-urgent
records that filename order and an inflated single-axis Priority keep surfacing.

## Non-goals

- No mutable `Urgency` token and no `--triage` update mode — urgency is carried by an
  immutable creation-time `Due` date, whose staleness is visible and computable.
- No dependency graph, propagation, or scheduler state — only direct `Depends On` links of the
  top-ranked candidates are inspected.
- No enforcement hook — ordering is advisory output (reminder layer), per hook-lightweighting.
- No repo-wide migration or backfill: existing tickets never gain a `Due` field, closed tickets
  are never touched, and legacy Priority values keep their historical meaning.
- No change to the request lifecycle: what `Status` means, and when a ticket closes, stay as
  they are.

## Invariants

- `INV-001`: `scripts/lib/request-status.js` is byte-unchanged — parser, `CLOSED_REQUEST_STATUS`,
  `HEAD_LINES` and precedence are not extended for ordering.
- `INV-002`: The four-field mutable set (Status, Progress table, AC checkboxes, Progress.Note)
  is unchanged; `Due` is written at authoring time only and never mutated by `--update` /
  `--update-all`. A renegotiated deadline is a successor ticket that supersedes, not an edit.
- `INV-003`: Ordering never bypasses gates — it selects the next work unit and never weakens
  its review, precommit, AC, or verification obligations.
- `INV-004`: Legacy fallback infers no urgency from P1/P2 (labelled `legacy-undated`); only a
  bare legacy `P0` whose age satisfies `refDate − Created ≤ 30` calendar days (day 30 inclusive)
  enters the emergency lane; an older one is flagged `stale-P0`, restorable to emergency only
  via a dated successor.
- `INV-005`: Ordering output is deterministic — an injected reference date (never the machine
  clock in tests), and path as the final tie-breaker.
- `INV-006`: A dated `Due` names an external referent (release, incident, commitment,
  dependent team) in the ticket Background; `none` is the creation default.

## Acceptance sketch

Against a fixture corpus containing a due-today Pending ticket, an undated Candidate Complete
ticket, a 5-month-old bare-P0 In Progress ticket, a fresh bare-P0 ticket, dated/undated
legacy P1 tickets, and a ticket whose `Depends On` targets an open sibling: with reference date
injected, `create-request --status` reports lanes in order Emergency (due-today + fresh-P0) →
Candidate Complete → In Progress (containing the stale-P0, flagged) → Pending → Design, a top-3
recommended queue with reasons, and a `Blocked urgent` row naming the direct open prerequisite;
`next-step` selects each feature's representative request by the same lane order, not filename
order; and the whole `request-status.js` test suite passes without modification.
