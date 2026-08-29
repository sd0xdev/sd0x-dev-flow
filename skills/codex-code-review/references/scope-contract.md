# Scope Contract — the review plane's authoritative procedure

Loaded on demand. `rules/scope-discipline.md` carries the resident guard — the semantics a session
needs *before* it knows it is reviewing anything. This file carries the mechanics: how the baseline
is computed and frozen, how a finding's scope is derived from reviewer fields, what the circuit
breaker measures, and which dispositions are valid. Load it on any of the five triggers listed
under "Where the two layers overlap" below — the canonical set; this paragraph does not restate it.

Every rule here was resident prose until 2026-08-29 and **the move changed no policy**
(`docs/features/rules-residency/2-tech-spec.md` § 3.4). Prose edits made in the move, so a reader
need not diff to find them: § Records now points at the resident literals instead of restating
them; § Anchor Compatibility gained the "resolve at step 0 / not new Register items" sentence back;
§ Gate Derivation was reworded where it forwarded to the review skill; two citations were
de-qualified to avoid a skill-permission edge; and one citation in § Closed-Set Options was
requalified to its repo-rooted path so the routing guard can resolve it.

**Where the two layers overlap, this file is canonical.** `rules/scope-discipline.md` § Resident Guard
and its § Load the full contract when state the same anchors and the same load triggers in summary
form, because a session must
carry them before it knows it needs this file; any disagreement between them is a defect in the
summary. The load triggers are the five that guard lists: a finding or edit outside the frozen
baseline · scope is `uncertain` · a review round is being dispatched or its gate derived · the
circuit breaker may have tripped · an E1 disposition is being created or validated.

## Scope Baseline (task-level, immutable)

The baseline file set is computed **once**, at Step 1 of the task's first review round
(§ Step 1 of `codex-code-review`'s workflow), then **frozen for the whole review session** —
initial reviewer, inline secondary, `--continue`, and every same-task re-dispatch read the same
frozen list; no path may recompute it.

| Variant | Baseline set |
|---------|-------------|
| `/codex-review-fast`, `/codex-review` | `git diff --name-only HEAD` ∪ untracked (`git ls-files --others --exclude-standard`) |
| `/codex-review-branch` (incl. `--dual`) | `git diff --name-only $(git merge-base ${BASE_BRANCH} HEAD)` ∪ the same uncommitted + untracked set |

`${BASE_BRANCH}` resolution: explicit argument first; else `git symbolic-ref --short
refs/remotes/origin/HEAD`; else `origin/main` — each candidate verified with `git rev-parse
--verify` before use. All candidates failing is a **parameter error**: abort the branch review and
ask for an explicit base — never proceed on an empty baseline (an empty baseline would misread
every unmodified file as out-of-scope). The abort is not a human exit. The resolved base and the
frozen list are written into the review report metadata.

The **only** update path is the explicit scope expansion of § Closed-Set Options option 1, and it
is a **monotonic precise union**: `baseline := baseline ∪ files the user explicitly named` (plus
per-file additions from a separately approved compatibility analysis). **Never re-run the
discovery commands**: re-scanning the now-dirty diff would absorb every file earlier fixes touched,
turning a one-file authorization into all dirty files — reopening exactly the sweep this rule
exists to close. Ordinary edits during a round never write back into the baseline.

## Scope Determination (mechanical — any one condition ⇒ in-scope)

1. **The file is in the baseline set** — pure set membership.
2. **The defect sits on a call path the baseline diff directly touches** — **one hop only**: a
   direct caller or direct callee of a symbol the diff modified, with the call site cited as
   `file:line`. No transitive expansion (one hop of one hop does not count). No citable call
   site → `uncertain`.
3. **The defect was introduced by this branch** — evidenced via `git log -L` / `git blame` showing
   the introducing commit on the branch.

`uncertain` is **fail-closed: treated as in-scope** for both gate and fixing. Misreading
pre-existing as in-scope costs a little extra fixing, capped by the circuit breaker; misreading a
branch-introduced defect as out-of-scope ships it. The asymmetry decides. Declaring out-of-scope
requires **complete negative evidence**: all three conditions individually shown false (not in the
baseline, no one-hop call site, not branch-introduced) — any missing negative ⇒ `uncertain`.

Non-code files (`.md`, config, data) have no call paths: only conditions 1 and 3 apply;
condition 2 is always negative.

## Behavior Table

"Critical" below = P0, or a security/data-integrity finding.

| Finding | Behavior |
|---------|----------|
| in-scope ∧ ≥ tier blocking severity | Fix per @rules/fix-all-issues.md — zero tolerance unchanged |
| in-scope ∧ sub-threshold | Existing `[NIT_DEFERRED]` mechanism, unchanged |
| out-of-scope ∧ not critical | Record `[OUT_OF_SCOPE_DEFERRED]`, summarize once at task end; **does not block `✅ Ready`** |
| out-of-scope ∧ critical ∧ no valid `[USER_SKIPPED]` | Gate reads `⛔ Blocked` with `gate_reason=OUT_OF_SCOPE_CRITICAL`; the model does **not** enter the fix loop — human exit E1 (closed-set options); a pass must not be noted |
| out-of-scope ∧ critical ∧ valid `[USER_SKIPPED]` | Authorized deferral: excluded from the gate's second disjunct; listed under the report's "Out-of-Scope Findings" section with its disposition |
| user explicitly says "fix it together" | Scope expansion: the named files become in-scope from then on and get full review |

## Records (reporting conventions)

Both mirror `[NIT_DEFERRED]` (@rules/auto-loop.md § Sub-Threshold Findings): emitted at column 0
with the field order fixed, greppable in reports and transcripts — **no TTL, no hook parsing, no
persistence**. The durable record is the review report and the conversation; every same-task
re-review prompt carries the currently valid dispositions, and `/codex-review-branch` re-finds
what is still true when it reviews at depth. Records must never contain secrets, tokens, or
passwords (Anchor Register #2).

The two literal field orders are stated **once**, resident, in `rules/scope-discipline.md`
§ Resident Guard — a session emits them during a fix pass, possibly without having loaded this
file. Restating them here would be the split-brain this extraction exists to avoid.

## Closed-Set Options (human exit E1)

For an out-of-scope critical finding, present **exactly three options, and only these**
(Default-tier policy):

1. **Expand scope to include the fix** — the named file becomes in-scope; expansion into a
   security/data-integrity file escalates review to `thorough` (Register #3); the round re-runs
   review at the expanded scope.
2. **Extract the urgent defect into its own change** — it gets its own review cycle; the original
   task pauses and, after the extracted fix lands, re-enters its own review gate at the
   then-current digest.
3. **Abort the original task.**

**Skip is never offered proactively.** The model must not present "skip it and finish as normal"
as an option; a skip exists only when the user raises it themselves. When they do, record
`[USER_SKIPPED]` — this implements the existing "User asks to skip" Default exception
(@rules/fix-all-issues.md), **bounded Anchor-first**: if the finding's content hits Anchor
Register #1 (a `rules/security.md` prohibition) or any other Register item, the Default exception
cannot override it — report the conflict through the proposal channel (@rules/discretion.md) and
do not record `[USER_SKIPPED]`.

A `[USER_SKIPPED]` is **valid** only when all of these hold: same finding identity (the
`skills/codex-code-review/references/review-common.md` identity contract: file + canonical issue
text — line numbers are not part of
identity, so line drift caused by other fixes does not break the match); the Anchor-first check
above passed at creation; same task; all fields present and well-formed. Any failure ⇒ fail-closed
invalid: the finding returns to the gate. A substantively different issue in the same file does
not inherit the old authorization.

**Creating a disposition does not close the standing verdict.** The earlier `⛔ Blocked` report
and its fail note remain the current gate record (the gate verdict is the reviewer's report —
@rules/auto-loop.md); the model must not re-read an old Blocked as Ready or note a pass directly.
It must re-run review (`--continue` or an explicit re-dispatch) carrying the disposition list, and
only a fresh reviewer verdict deriving to `Ready × NONE` may be noted as pass.

## Helper-Sweep Ban (precise)

What is banned is the **repo-wide consistency sweep with no evidence of impact**: a helper or
pattern created to fix an in-scope finding is applied to scope-hit files only; "while I'm at it,
convert every same-shaped call in the repo" is not fixing, it is a scope violation. What is
**not** banned: interface-compatibility updates — when this branch changes a helper's signature or
semantics, updating its **direct callers** falls under condition 2 (one hop, cited call site) and
is ordinarily in-scope.

## Circuit Breaker (stops expansion; never rewrites scope)

The reference set is the **immutable task baseline** above plus its derived top-level directory
set; the **counters are round-scoped** — they reset at each review round, but always compare
against the task baseline, and new edits during a round never write back into it (otherwise an
edited file enters `git diff HEAD` and "non-baseline file" stops being mechanically decidable,
and per-round refreezing would grant the breaker a fresh five-file budget every round). Files at
the repo root (no first directory segment — `CLAUDE.md`, `package.json`) map to the virtual
bucket `<root>`, which counts as one directory for the second-subsystem trigger.

Trigger (judged against the baseline): within a single review round, fix edits touch **more than
5 files outside the baseline set**, or touch a **second top-level directory** outside the
baseline's directory set.

On trigger the breaker **only stops further expansion** (no more edits to new non-baseline
files); it has **no reclassifying force** over findings already on the table:

| Remaining finding | Disposition |
|-------------------|-------------|
| Independently out-of-scope (complete negative evidence) | `[OUT_OF_SCOPE_DEFERRED]`, per the behavior table |
| in-scope (incl. `uncertain`) ∧ ≥ blocking | **Must not be deferred**: the gate stays `⛔ Blocked` — human exit E2; the trigger itself is the signal that the fix footprint no longer matches the task (often `ARCHITECTURE`, but E2 stands on its own enumeration and needs no prior classification) |
| in-scope ∧ sub-threshold | `[NIT_DEFERRED]`, unchanged |

Thresholds (5 files / second subsystem) are the issue's proposed values — review them after the
first real trigger.

## Gate Derivation (normalization-first)

Reviewer findings carry `origin=<in-diff|pre-existing|uncertain>`,
`scope_reason=<diff-file|one-hop|branch-introduced|pre-existing-outside|uncertain>`, `evidence`,
and the field `scope=<in-scope|out-of-scope>` — **derived, not free**: `out-of-scope` ⇔
`origin=pre-existing ∧ scope_reason=pre-existing-outside`. Fail-closed reading: a missing field, an unknown enum
value, a contradictory combination (`origin=in-diff ∧ scope=out-of-scope`), or a
`pre-existing-outside` whose evidence lacks the complete negative case ⇒ `uncertain` ⇒ in-scope.
A reviewer that forgets the fields degrades to today's behavior, never to something looser.

`⛔ Blocked` ⇔ there exists an "in-scope ∧ ≥ tier blocking severity" finding **or** an
"out-of-scope ∧ critical ∧ no valid `[USER_SKIPPED]`" finding. The report's Gate section carries
`gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH>`; `NONE` is the only combination
lawful with `✅ Ready`. **Routing always follows the value derived from normalized findings,
never the reviewer's declaration** — a declared `Ready × NONE` wrapping a real in-scope blocking
finding routes as `Blocked × IN_SCOPE_BLOCKING`, and a declared `Blocked` with no blocking
finding routes as `Ready × NONE`; findings too incomplete to derive ⇒ conservatively
`Blocked × BOTH`. Other out-of-scope findings never block `✅ Ready`; they are listed in the
report's "Out-of-Scope Findings" section. The full routing matrix lives in `codex-code-review`'s
§ Step 4.5. The dual-reviewer field-level
merge (conservative: any in-scope or `uncertain` source ⇒ in-scope; out-of-scope only when every
source independently proves it) and the prompt field contract live in
`skills/codex-code-review/references/review-common.md`.

## Human Exits (enumerated here — closed list)

- **E1 `OUT_OF_SCOPE_CRITICAL`** (including the leading decision of `BOTH`): an out-of-scope
  critical finding awaits the user's choice among the closed-set options.
- **E2 breaker-triggered with in-scope blocking findings remaining**: the fix footprint no longer
  matches the task; the user decides re-scope or abort.

These two, together with the exits `rules/auto-loop.md` enumerates, form the closed list of human
exits (root `CLAUDE.md` states the union).

## Anchor Compatibility (inherited Register hits — resolution step 0)

Scope classification decides **which findings demand a fix — it never exempts any actual edit
from re-review**: whenever an edit lands, the digest moves, the plane re-opens, and the reviewer
re-runs (Register #6). There is no user exception to this sentence. The Anchor hits this rule
inherits resolve at step 0 and **are not new Register items**. Scope expansion into
security/data-integrity files is reviewed at `thorough` (Register #3). Deferred/skip records
never carry secrets (Register #2). A finding whose content hits `rules/security.md` takes
Register #1 precedence over any skip (§ Closed-Set Options).
