# Push Gate Opt-In — Implementation Notes

Implementation record for the r1–r5 work. This document owns the design arguments that are too long
to live as code comments (`@rules/docs-writing.md` § Code Comments); the code carries pointers to the
sections below.

**What this file no longer holds.** Until 2026-08-20 this file's § 1 was a section on `/smart-rebase`
ref-name and fetch safety — 82% of the file, and about a different feature. Doc review called the
ownership mismatch, and it moved to
[`../ref-name-hardening/4-implementation.md`](../ref-name-hardening/4-implementation.md) as **§ 1 of
that file**; the § 1 below is a different section entirely. **Byte identity across the move is not
claimable here** — both files are untracked, so `HEAD` holds no pre-move blob and no reader has an
artifact to check it against (the ref-name ticket's own move AC says so and lists the weaker facts
that *are* checkable: destination section structure, absence of that content from the source, and
valid links). Section numbers were kept, so inbound pointers needed only a new path. The stated
reason for keeping the smart-rebase material here had been that it is one argument whose parts cite
each other — true, and that property is served by
moving it whole; the pointer updates were work, not an argument against the move.

**Size disposition, 2026-08-21 (rounds 35–36): past the 500-line signal, split deferred.** No count
is written here — this note's own length moved the number the moment it was drafted, which is the
mistake `ref-name-hardening` r1 already records against this file. Derive it: `wc -l` on this path.
The three remedies in order —
**pruned** § 4.5's `$-`-discriminator archaeology (round 35 retired `$-` as the discriminator; the
measurement went, the lesson did not); **merged** that lesson into § 4.3 where the re-exec lives, and
§ 2's re-narration of round 30 into a pointer at § 2.1's table; **deferred the split to its own
change**.

That last word is the honest one, and round 36 is where it got honest. The first version of this
note gave two reasons for not splitting, and **doc review was right that neither carried the
decision** — one of them I had already found overstated myself, before the report arrived:

| Reason as first written | What is actually true |
|-------------------------|----------------------|
| "`ref-name-hardening` r1's pointer audit is about pointers to *this* file" | Its table is about pointers to the **destination** file. Only its closing exclusion note concerns a pointer to this one (`test/skills/smart-rebase.test.js` → § 2.1, deliberately left) |
| "`2-tech-spec.md` **§ 4** carries a derivation command a split would silently change" | It is **§ 5 Open Questions**, and the derivation command is at `:200`. The command is real and returns 4 today — but that spec is a **Design record** (`scripts/lib/doc-metadata.js`), so the correct handling of a stale count there is a dated note, which is ordinary work rather than a reason to avoid a split |

What survives is smaller and is a scheduling claim, not a cohesion one: a split moves this file to
`4-implementation/4-implementation.md`, and **every inbound pointer breaks, including the ones inside
frozen records**. Repointing those is not a tidy-up to fold into round 36 of a security-gate loop —
it is the change `ref-name-hardening` r1 spent a whole audit documenting the last time it happened.
So the split is owed, it is deferred deliberately rather than declined, and
[`./review-log-push-gate-optin.md`](./review-log-push-gate-optin.md) § Round 36 carries it as a
named follow-up — a history record, appended to, which is where an outstanding obligation belongs
rather than in prose someone may read as a decision. Anyone doing it starts by reading that audit.

## 1. The formatter is a writer, and the tree it writes to is the reviewed one

`/precommit` runs `lint:fix` **before** the tests, so `markdownlint-cli2 --fix` edits files inside
the same gate that is supposed to certify them. Measured here: it made 11 fixes to
`skills/epic-merge/SKILL.md`, whose bytes are pinned by `SKILL_DIGEST` in
`test/skills/epic-merge.test.js`. The digest is what surfaced it — the run failed on the pin, not on
anything the formatter reported, and the pre-fix bytes were already gone by then (no backup in the
tree matched the old digest). The pin was re-established by auditing the **current** bytes against
the contract rather than by trusting that a formatter only reformats.

That ordering is deliberate and stays: a fix applied after the tests would ship unverified. What the
episode establishes is narrower and is the reason this section exists — **a digest pin over a
document a formatter can reach is not redundant with reviewing the document.** Without it the
rewrite is silent, and an Anchor-bearing skill file is exactly where silent is unacceptable.

**What the fixer can reach inside a fenced block**, measured against this repo's
`.markdownlint-cli2.jsonc` (`default: true`, with MD013/MD033/MD024/MD026/MD032/MD036/MD040/MD041/MD060
off):

| Rule | Inside a ```` ```bash ```` fence | Consequence |
|------|-------------------------------|-------------|
| MD010 | Converts a hard tab to a space | A `$'\t'` fixture, an `IFS=$'\t'` split, or a heredoc whose body is tab-indented (`<<-`) changes meaning |
| MD014 | Strips a leading `$` prompt — **but only when no output lines are present** | A terminal transcript becomes an executable-looking block. Found by the reviewer, not by the probe: the probe's fixture happened to include output |
| MD009, emphasis characters, bare URLs | Left alone | — |

The generalization: a probe over a formatter is only as good as the fixture it runs on, and a
fixture that happens to sit outside the rule's trigger condition reports "safe" for a rule that is
not.

## 2. A closing grep proves what its patterns can reach, and nothing else

r3 required a repo-wide grep showing no residual unconditional terminal-confirmation claims, and it
ran clean over `rules/`, `skills/` and all six READMEs. One residual survived it anyway, in
`rules/discretion.md`, then in § Proposal Channel — the paragraph now has a section of its own,
§ Efficacy Boundary, for the reason § 2.1 below records:

> …it cannot bypass a stronger mechanism an anchor names (for push, `pre-push-gate.sh` over
> `/dev/tty` is the credential and AskUserQuestion is advisory).

Three properties made it invisible, and each is the general lesson rather than a detail of this
sentence:

| Property | Why the grep could not reach it |
|----------|--------------------------------|
| It is a **parenthetical**, phrased as an aside | None of the three alternations (`terminal hook … final gate`, `final authorization gate`, `最終授權閘門`) appear in it — it states the same contract in different words |
| It sits in the **same paragraph** as the corrected text | Two sentences later the paragraph says "but only where that mechanism exists". The file is self-correcting, so every *reading* of the section looked right |
| The positive test assertion was `assert.match(prop, /pre-push-gate\.sh/)` | It asks that the name appears. The old wording and the new one both contain it |

The fix was the conditional wording plus a **negative** pin —
`assert.doesNotMatch(prop, /is the credential and AskUserQuestion is advisory/)` — whose positive
direction was carried by the conditional assertions already beside it, which use the same words
lawfully.

**That phrase pin no longer exists, and its removal is the finding this paragraph now records.**
Round 30 measured it failing in **both** directions — § 2.1's table states that measurement in
sequence with the two controls that followed it, which is where it reads as the argument it is. A
phrase blacklist is a hypothesis about spelling; the contract is the text. The control that
replaced it is `validateEfficacyBoundary` (`test/rules/discretion-tiers.test.js`; locate it by name —
an earlier version of this sentence cited `:941` and the function had already drifted to `:953`), which pins
the whole `## Efficacy Boundary` section by byte identity after normalizing blank-line runs — so any
sentence added, removed or reworded anywhere in it fails, wherever it is placed. The old parenthetical
survives only as a **mutation fixture** — the case keyed `"the pre-opt-in parenthetical restored"` in that
file’s mutation table (cited here by key, not by line: the earlier `:986-988` had drifted to `:998`) — which
is what keeps this paragraph's original claim verified: restoring it still turns the test red.

**A pattern list is a hypothesis about how a claim will be spelled.** Where the claim is a contract,
the durable control is a pin on the text that states it, not a search for the phrasings someone
predicted it would use.

### 2.1 Choosing the unit a pin is written over

Three review rounds, each defeating the previous control with something measured rather than
argued. The sequence is the point: every intermediate answer looked correct until the next round
executed against it.

| Round | Control | Defeated by |
|-------|---------|-------------|
| 30 | A phrase blacklist (`assert.doesNotMatch`) | Wrong in **both** directions: a synonymous unconditional sentence — "`pre-push-gate.sh` remains the final authority; AskUserQuestion merely advises" — passed it, while a *lawful conditional* rewording containing the blacklisted words was rejected |
| 31 | Byte pin over the blank-line-delimited paragraph | The same sentence as its own paragraph two lines lower, still inside the section: canonical bytes untouched, still exactly one line beginning `Efficacy boundary:`, suite green |
| 32 | Byte pin over the whole `## Proposal Channel (efficacy boundary)` section | A **tier error**, not a bypass: the section also held Default-tier prose, so "is the wrong reading" → "remains the wrong reading" failed an Anchor-named test. A pin that blocks ordinary edits gets weakened by the next maintainer, taking the closure with it |

The resolution was to change the **rule file**, not to re-tune the pin: `## Proposal Channel` keeps
the triggers and the uncertainty exclusion and is not pinned; a new `## Efficacy Boundary` holds the
Anchor-tier material — credential selection **and** the review obligation that survives that
authorization (Registers #5/#6) — and is pinned whole.

Two precisions, both of which this section stated loosely until doc review caught them — and the
first one took **two** rounds to state correctly, which is itself the point being made here.

**What "whole" means, measured.** It is not byte-for-byte: the validator collapses each blank-line
run to a single blank and drops trailing blanks. But round 2's replacement wording — "every non-blank
line, in order" — was also wrong, in the opposite direction: collapsing a run to one blank is not the
same as ignoring it. Measured against the validator itself:

| Edit inside the section | Pin |
|-------------------------|-----|
| One blank line becomes two | **Free** — run length is normalized away |
| Trailing blank lines added or removed | **Free** — dropped before comparison |
| A blank line *removed*, joining two paragraphs | **Fails** — the run no longer exists |
| A blank line *inserted* mid-paragraph, splitting one | **Fails** — a run exists where none did |

So what is pinned is every non-blank line **and the presence and position of every blank run**; only
run length and trailing blanks are free. Two rounds of describing a control loosely, on a page whose
whole subject is describing controls precisely, is the argument for measuring the validator rather
than reading it.

**And the section holds two things, not one** — writing "the contract and nothing else" reads as
though the closing review-obligation sentence were outside the intended boundary, which is exactly
the wrong repair to hand the next maintainer.

**That is the generalizable part.** A byte pin is only correct where the pinned unit and the
contract have the same boundary. When they do not, the honest fix is to move the boundary — give
the contract a section — rather than to widen the pin (which over-reaches) or narrow it (which
leaves the neighbourhood open). Round 30's blacklist and round 31's paragraph were both attempts to
avoid that edit.

The residual is stated in the test rather than implied: a contradictory statement in a *different*
section of `rules/discretion.md` is not seen. Round 32 searched for one and found none — the
efficacy rule is written in that section and nowhere else. If it is ever restated elsewhere, the
restatement is the thing to remove, not the pin to widen.


## 3. A branch is shared when someone says so, not when git can tell

`rules/git-workflow.md` § Prohibited has always banned force-pushing a **shared** branch, and never
defined the word. The gate implemented it as the protected set — `main`, `master`, `develop`,
`release/*` — which is the half a branch *name* can decide. The other half stayed open and was
stated rather than hidden: a two-person `feat/*` head is shared too, and both `/push-ci` and
`/epic-merge` would lease-force it. That admission sat in three documents for as long as it was
true. It was closed on 2026-08-21 as option A of
[`requests/2026-08-20-push-ci-force-with-lease-r5.md`](./requests/2026-08-20-push-ci-force-with-lease-r5.md)
§ 使用者裁示: *define an attestable non-shared class, and refuse the force-push without the
attestation.*

**Why the class is attested and not inferred.** The obvious implementation is to have the hook work
sharedness out for itself, and there is nothing to work it out from. A pre-push hook is handed
`<local-ref> <local-sha> <remote-ref> <remote-sha>` per ref and the remote's name; none of those says
who else has the branch. Neither does anything the hook could go and ask for: an ancestry test says
whether history diverged, not who diverged it; `--force-with-lease` compares against *this clone's*
remote-tracking ref, so it is satisfied by a colleague's commit this clone has already fetched;
`git log` author names say who wrote commits that are already here, not who is about to write more.
Sharedness is a fact about people's intentions, held outside the repository. So the class is defined
by an **attestation** — the operator states it, about branches named back to them — and the mechanism
is the same primitive the protected gate uses, for the same reason: `/dev/tty` is read from the
terminal, so it cannot be auto-answered by the session permission caching that can silently approve
an in-session prompt.

**Where it sits, and why there.** `scripts/pre-push-gate.sh` runs it *after* the non-fast-forward
refusal and *before* the protected-branch bypass. Both edges matter:

| Placement | Consequence |
|-----------|-------------|
| After the non-fast-forward refusal | A push with `ALLOW_FORCE_WITH_LEASE` unset is already refused there, and refusing is not authorizing. Attesting first would ask the operator to vouch for a push that never happens |
| Before `ALLOW_PUSH_PROTECTED` | That variable answers "may I push to a protected branch", not "is this branch shared". Letting it fall through the attestation would make one bypass silently buy the other |
| Scoped to non-protected targets — **only while the protected gate will actually ask** | A protected force target normally reaches `/dev/tty` via the gate below, so prompting here too asks the operator twice about one push: noise, not depth, and noise is what trains people to type `yes` without reading. But the exclusion is only as true as its premise. `ALLOW_PUSH_PROTECTED=1` makes that gate `exit 0` without asking anything, so under it a protected force target has no second prompt to fall through to and returns here. Written unconditionally — as this row was — the two variables composed into a force-push of `main` past both gates in silence |

The prompt reads on **fd 4**. The protected gate owns fd 3 and closes it after its own read. The two
**do** run in the same push, and routinely: a ref set holding one rewritten protected branch and one
rewritten unprotected branch — `ALLOW_PUSH_PROTECTED` unset, `ALLOW_FORCE_WITH_LEASE=1`,
`ALLOW_FORCE_UNSHARED` unset — fires the standalone attestation for the unprotected ref, and then
**one** prompt for the protected one carrying *both* credentials — the table row directly above is
why: excluding a protected rewrite from the standalone prompt is sound only if the prompt it falls
through to actually puts the other question, so that prompt carries it. Measured under a pty,
2026-08-22 (git 2.55.0);
the `Remote: origin` lines, the explanatory sentence under the first banner and the blank lines are
elided, and `yes` is what the driver typed:

```
pre-push-gate: Force-form push rewriting ref(s): feat/x
Type 'yes' if nobody else works on feat/x: yes
pre-push-gate: Pushing to protected branch(es): main
  (main: this REWRITES history — the remote tip is not an ancestor of what replaces it.)
Type 'yes' to confirm push to main AND attest that nobody else works on main: yes
… + d4429e8...d7547fc feat/x -> feat/x (forced update)
… + 1a3aa70...db22690 main -> main (forced update)
EXIT=0
```

**Round 75 correction.** The block above previously showed the second prompt as the bare
`Type 'yes' to confirm push to main:` and omitted the rewrite warning entirely — a transcript of a
gate that stopped existing the moment the attestation was folded into the protected prompt. It was
never re-measured after that change, so it kept describing the two-prompt shape as one plain
confirmation plus one attestation the protected ref never got asked. The replacement is a fresh
capture, not a hand-edit of the old one.

One descriptor would in fact still serve, because fd 3 is opened only after `exec 4<&-` — but
that is a property of the current *ordering*, not of the scoping, and an earlier draft of this
paragraph claimed the opposite of both. Two descriptors state the ownership in the code instead of
in a comment that can go stale, which is what this one did.

**No terminal is a refusal, and says which refusal it is.** `{ exec 4</dev/tty; } 2>/dev/null`
probes by opening, not by `[ -c /dev/tty ]` — the node exists in contexts where opening it fails, and
there `read` returns an empty answer that is indistinguishable from a declined attestation. The
operator would be told they aborted when the environment did. The two exits therefore carry different
text: *"Cannot open /dev/tty"* names the environment and prints the non-interactive form
(`ALLOW_FORCE_WITH_LEASE=1 ALLOW_FORCE_UNSHARED=1 git push --force-with-lease …` — **both**, because
this is the second of two gates: reaching this message means the lease variable was set on the
invocation that printed it, and the operator copies the line into a new command where it is not.
Measured 2026-08-21: the attestation alone was refused by the earlier non-fast-forward check at
exit 1. A recovery hint that does not recover is worse than no hint, so the test replays the printed
form rather than matching a variable name in it); *"ref not attested as unshared"* names an
answer that was given and was not `yes` — **"ref", not "branch"**, and quoting it either way is not
cosmetic: a forced tag update is a rewrite too, so the noun is pinned by the test *a forced
non-branch ref is described as a ref, not as a branch* and argued for in § 4.1.

**`ALLOW_FORCE_UNSHARED` is developer-set only.** `/push-ci` § Prohibited and `/epic-merge` both
carry the ban, beside the identical one on `ALLOW_PUSH_PROTECTED`. The reason is the same in one
sentence: the variable *is* the attestation, so a skill that sets it is answering its own question.
`/epic-merge` is the sharper case — it pushes in a loop, which is exactly the shape session caching
makes unsafe.

**What is left open, stated rather than implied.** An attestation cannot reach an operator who
answers `yes` about a branch someone else does hold. It moves the failure from a silent one to a
stated one, which is the whole of what it claims. And where the hook is not installed at all, what is
missing is the **terminal** attestation, which is not the same as none. `rules/git-workflow.md`
§ Push safety obliges `/push-ci` and `/epic-merge` to put the unshared question to the operator
**themselves, by name and before the force approval**, and to refuse the push when the answer is not
the attestation — `skills/push-ci/SKILL.md` Phase 1 and `skills/epic-merge/SKILL.md`
§ Iteration Gate Design are where it is asked, in both modes. What the un-hooked case loses is the
credential session caching cannot auto-approve, not the question: `/push-ci`'s per-use
AskUserQuestion is then the whole approval, which is the disjunction `rules/discretion.md`
§ Efficacy Boundary already governs. An absent gate moves the question; it never deletes it.

Tests: `test/scripts/pre-push-gate.test.js`. **Do not read a count out of this paragraph** — the
number moves every time a case is added, and a stated total is wrong the moment it does. What is
stable is how to obtain it: disable the guard and see what goes red.

```bash
# 1. replace the gate's condition with `if false; then`
# 2. node --test test/scripts/pre-push-gate.test.js
# 3. restore from a copy taken first — never with git, the file may be untracked
```

Measured on 2026-08-21: **9** cases go red. The denominator is deliberately not written here, and
the reason is a history rather than a preference: it was stated as `34`, then as `43`, and each
time it was stale before anyone read the sentence telling them not to rely on it. Both numerals are
now gone from this section, and so is the third one that replaced them — a paragraph whose own first
sentence says not to read a count out of it must not carry one, and every previous fix left one
behind while removing another. Three cases more exercise the gate and are *supposed* to survive it,
which is the half a kill count cannot show — read the distribution, not the total:

| Case | Why it survives a disabled guard |
|------|----------------------------------|
| *an ordinary fast-forward push to a non-protected branch is untouched by the attestation* | The negative control. It asserts the gate does **not** fire here, so removing the gate cannot break it. Without it, a gate that refused every push would satisfy every other case in the file |
| *a protected force target is asked once, by the protected gate, not twice* | It asserts **scoping**, not existence. The protected gate still asks once when this one is gone |
| *both bypasses set + the attestation given → the push is allowed* | It asserts the gate is **closable**. A push that passes with the attestation also passes with no gate at all |

The nine that die: both terminal answers under a pty (2), the no-terminal refusal and its distinct
wording (2), the `ALLOW_PUSH_PROTECTED` cross-product that used to pass in silence (2), the
mixed-ref case that used to ask about refs it was not rewriting (1), the non-branch ref naming (1),
and — the one an earlier version of this list dropped, leaving it enumerating eight — *`ALLOW_FORCE_WITH_LEASE`
bypasses non-fast-forward check* (1), which asserts that the lease variable **alone** must not
produce a pass. In a paragraph whose whole instruction is to read the distribution rather than the
total, losing the case that establishes "lease alone is not enough" was the worst one to lose. The
gap between those nine and the rest of the file is not slack: the other cases guard *different* mechanisms — which refs count as rewritten
(§ 4.1), which bash the hook runs under (§ 4.2), and what a startup file can do to it (§ 4.3) — and
a case that dies when you break something else is a case testing something else.

## 4. Ways a rule can be right about the wrong set

Round 31 found four defects in the gate above, and three share a shape worth naming: a rule that is
correct for the class it was written against, applied to a class it was never true of. None was a
logic error. Each was a *scope* error, and scope errors survive review by looking like the rule
they came from. Round 34 added a fifth (§ 4.5) with the same shape and a different victim — the
rule was in the *installer*, not the gate — which is why the heading no longer counts them: the
count was wrong within one round of being written, twice.

Round 35 is the round that makes the shape unmistakable, because three of its four defects were in
**the fixes written the round before**. The stanza that closed § 4.5 reached the gate through six
bare command words, each one a decision handed to whoever ran `git push`. The gate's own privileged
re-exec decided correctly and then acted through `exec`, a shadowable builtin. And the environment
prefix that closed the configuration channels carried `-u GIT_NO_REPLACE_OBJECTS`, a name whose
*safe value is set*, so the strip list had spent a round enabling the very thing it read as a guard.
The common cause is not carelessness — it is that a fix is written against the failure that
prompted it, and its own class membership goes unexamined. § 4.3's "licenses / does not license"
table exists for that reason; these three are what it looks like when the discipline is applied to
a mechanism and not to the fix for it.

### 4.1 A tag is not a branch, and ancestry is the branch question

The gate asked `git merge-base --is-ancestor`: is the remote tip an ancestor of what we are
pushing? For a branch that is exactly right — a yes means history is being extended, a no means it
is being overwritten. For a **tag** the question does not apply. git refuses *any* update to an
existing `refs/tags/*` ref that does not carry **force semantics**, forward moves included, because
a tag names one commit rather than a line of history. "Force semantics", not the bare `--force`
flag: measured 2026-08-21 on a tag whose target was a strict ancestor of the new one, a plain push
was rejected with *"the tag already exists in the remote"* while `--force`, a satisfied
`--force-with-lease=refs/tags/<t>:<oid>` and a leading `+` in the refspec each reported
`(forced update)`. Naming one flag would have been a rule about a spelling; what the gate reads is
the topology, and all three spellings produce the same one. So a tag moved to a descendant answered "yes, fast-forward"
and walked past a gate that exists to catch exactly what git itself was calling a forced update.

`is_tag_ref` now **overrides** the ancestry test for that namespace. Not short-circuits, and the
distinction is worth one sentence because round 54 wrote the wrong one: the condition is
`! git merge-base --is-ancestor "$remote_sha" "$local_sha" || is_tag_ref "$remote_ref"`, and `||`
evaluates left to right — so `merge-base` runs on **every** ref, tags included, and `is_tag_ref` is
consulted only when it answered "yes, fast-forward". What is true is that its answer never
*decides* for a tag: whichever way it goes, the OR puts the ref in the class. Documenting that as a
short-circuit claimed the graph is not consulted at all, which would have been a real property —
a tag's classification independent of a corrupt or slow object store — and the gate does not have
it. Two boundaries came with it,
because "every `refs/tags/*` line is a rewrite" would be a *different* wrong rule: creating a tag
is excluded by the null-OID test (there is no history to overwrite), and a ref listed with an
unchanged OID is excluded by an equality test added at the same time — asking an operator to vouch
for a ref that is not moving is how a prompt gets answered without being read.

Round 64 adds the boundary those two were written without: the null-OID test is applied to **both**
sides, so it excludes a **deletion** exactly as it excludes a creation, and the same paragraph in
`rules/git-workflow.md` read as though it did not — "every update to an existing tag is asked
about", with creation and unchanged-OID given as the complete set of exceptions. What was wrong was
the enumeration, not the gate: `git push origin :refs/tags/v1` removes a tag other people hold and
reaches no prompt, by construction, and the gate's own comment has always said so. The rule now
names it and stops there. Extending the class to deletions would be a *widening* of a security gate
— a new question, a new attestation, a new refusal path — and that belongs to a request ticket and a
human decision, not to closing a documentation finding. **Put and answered, 2026-08-22**: no
change — the class stays about overwriting a line of history. What round 64 delivered is therefore
the enumeration and its two-direction pin (`test/scripts/pre-push-gate.test.js`: an existing tag
deleted exits 0 and is not reported as a rewritten ref; the same tag moved forward is still asked
about), which is what makes a future widening a deliberate move rather than an accident.

The refusal message keeps its exact wording and gains a qualifying line only when a tag is in the
set. That asymmetry is deliberate: a tag can be refused here while being a textbook fast-forward,
so the unqualified headline would send its operator looking for a divergence that does not exist —
but rewording the headline itself would have hollowed out a negative control that asserts a *branch*
creation is never reported as non-fast-forward. A pin that can no longer fail is not a weaker pin,
it is an absent one.

### 4.2 The suite ran a bash the hook never runs under

`set -u` plus `"${arr[@]}"` on an **empty** array is an unbound-variable abort in bash 3.2, and
bash 3.2 is `/bin/bash` on every macOS. bash 4.4 made the empty expansion legal. The gate's
protected-branch loop had no count guard, so a push git listed no refs for — the documented exit-0
case — exited 1 on stock macOS while the suite, running a Homebrew bash 5, stayed green.

The test now runs the case under `/bin/bash` *and* `bash`, and says in its own comment that it
discriminates only where `/bin/bash` is older than 4.4. That admission is the point: on a Linux
runner it is a regression net and nothing more, and a test whose comment overstates its reach is
how this defect survived in the first place.

One interaction is worth recording, because it was introduced and caught inside the same round: the
privileged re-exec of § 4.3 originally re-executed a bare `bash`, which resolves through `PATH`.
That silently swapped `/bin/bash` 3.2 for the Homebrew 5.x on macOS — so the fix for § 4.3 made
the test for § 4.2 vacuous, and the mutation run proved it by leaving the guard's removal green.
`"${BASH:-/bin/bash}"` preserves the interpreter git actually invoked. The fallback became
absolute in round 35: a bare `bash` is one more word an imported function can answer, and `BASH`
itself is not forgeable — bash overwrites any inherited value with its own path at startup
(measured: `env BASH=/tmp/evil-bash bash -c 'echo $BASH'` prints `/bin/bash`).

### 4.3 What a hook cannot defend, and who can

A non-interactive bash sources `$BASH_ENV` **before line 1** of the hook, and imports any
`BASH_FUNC_name%%` variable as a shell function. Either rewrites what the gate does: an assignment
restores the `ALLOW_FORCE_UNSHARED` that `/push-ci` just cleared; a `BASH_FUNC_git%%` replaces
`git` so the ancestry test answers however the caller likes.

The defence is split across two layers, and the split is not a preference — it is where each vector
can actually be reached:

| Vector | Closed by | Why not the other layer |
|--------|-----------|-------------------------|
| `BASH_ENV` with a plain assignment | Hook: the `-p` in the marker re-exec (`/usr/bin/env … 'SD0X_PRIV_REEXEC=1' "${BASH:-/bin/bash}" -p …` — an **ordinary** command, not `exec`; see § 4.7) | `-p` is what closes it — a privileged shell does not source `$BASH_ENV` at all. The `env -u` names are belt-and-braces, kept because they also cover `$ENV` for a `sh`-invoked reader and cost nothing |
| `BASH_FUNC_x%%` function import | Hook: the same `-p` | Here the `-p` is the **only** thing that works: the caller cannot unset a wildcard, and `env -u` needs a name |
| `BASH_ENV` with an **exported** assignment | Caller: `env -u BASH_ENV -u ENV` before every push | Survives the re-exec — and must, since an exported `ALLOW_FORCE_UNSHARED` is also the operator's own legitimate channel, and the hook cannot tell the two apart |
| `BASH_ENV` that simply runs `exit 0` | Caller, same prefix | The first shell has already run it by the time line 1 exists. Nothing inside the hook was ever going to catch this |
| **`PATH`, pointing `git` at another binary** | **Neither layer — and not for the reason this row used to give** | Two questions hide behind one variable. *Inside* the hook `PATH` is inert: git **prepends its own exec-path** before running a hook, so an injected entry is shadowed (measured — the hook resolved `/opt/homebrew/opt/git/libexec/git-core/git` and printed the real version). But the skill's `git push` is resolved through `PATH` **before any hook exists**, and that process *is* the attacker's. Measured 2026-08-21: a `PATH`-first wrapper doing nothing but `exec <real git> "$@" --no-verify` pushed to protected `main` with exit 0 and no gate, where the same push was refused at exit 1. The hook was not "never reached" — it was **bypassed** |
| **`GIT_CONFIG_COUNT` / `_PARAMETERS` / `_GLOBAL`, choosing the configuration** | **Caller: the `GIT_*` half of the same prefix** | `core.hooksPath=/dev/null` through that channel removes the gate outright; `url.<host>.insteadOf` leaves the gate running and sends the approved refspec to another server. Measured 2026-08-21 — see below. `GIT_CONFIG_COUNT` is the whole `KEY_n`/`VALUE_n` mechanism, so unsetting the one name closes an unbounded family |
| **`GIT_GRAFT_FILE` and `$GIT_DIR/info/grafts`, choosing the ancestry** | **Both layers, and the closer is a value — `GIT_GRAFT_FILE=/dev/null`** | The subtlest of the set: the gate is installed, runs, and answers wrongly. A graft makes `merge-base --is-ancestor` return 0 for a rewrite, so the gate classifies it as a fast-forward and asks nothing. Two channels, one closer, because the second is the *default path of the first*: `unset GIT_GRAFT_FILE` hands the lookup back to `$GIT_DIR/info/grafts`, a file inside the repository that no `env -u` reaches — so unsetting closes the environment channel by opening the repository one. Measured 2026-08-21: honest 1, with a repository grafts file 0, with `unset` **still** 0, with `/dev/null` 1. Both layers set it: the caller prefix for the six authorized push sites, the hook for the developer's own push, which passes through no skill |
| **`refs/replace/*` in the repository, choosing the ancestry** | **Both layers — `GIT_NO_REPLACE_OBJECTS=1`, SET rather than unset** | The same lie through a third channel, and the same shape of closer for the same reason. Unsetting the variable is git's *default* — honour replacements — so the prefix spent one round enabling it. Only a positive `=1` disables it. Measured 2026-08-21: honest ancestry 1, with a `git replace --graft L R` in place 0, with the variable set 1 |
| **`BASH_FUNC_set%%`, shadowing a builtin the hook runs BEFORE the re-exec** | **Hook: ordering** — `set -euo pipefail` moved below the re-exec | Round 36. `set` is a builtin and bash resolves functions before builtins, so strict mode on line 19 was itself answerable by an imported function. Measured: baseline exit 1, with `BASH_FUNC_set%%='() { exit 0; }'` exit 0 before one ref was read; `bash -c 'set -euo pipefail; echo UNREACHED'` prints nothing. `-p` does close it — but only from the re-exec **onwards**, which is the whole point |
| **`SHELLOPTS=privileged` plus a forged `SD0X_PRIV_REEXEC=1`, skipping the re-exec entirely** | **Hook: the argument count**, not the marker | Round 37, and it is why no environment value can be the credential. Measured: bash reads `SHELLOPTS` **after** importing the environment, so privileged mode entered that way still imports `BASH_FUNC_*` (`type marker` → `marker is a function`), while `-p` on the command line is read **before** and does not. `$-` contains `p` either way, so it cannot tell them apart. git's pre-push contract is exactly two arguments and nothing in the environment changes that count, so `$# >= 3` — which the privileged re-run produces by appending three sentinels — is reachable only through that re-run. A forged marker now falls back **into** the re-exec instead of past it, which strips `SHELLOPTS` and re-enters via the flag |
| **`BASH_ENV` defining `/usr/bin/env` itself, in the CALLER's own shell** | **Caller: step 0a DETECTS it; no layer closes it.** `bash -p` would; a markdown fence cannot ask for `-p` | Round 55, and it corrects round 54. The absolute path closes the **import** vector — bash refuses `BASH_FUNC_/usr/bin/env%%` — and that was written up as immunity, which it is not. Measured 2026-08-22: a `$BASH_ENV` file containing `function /usr/bin/env { … }` is sourced before the fence's first line, defines that exact name in the caller's shell, and intercepts the prefix — the child printed `HIJACKED`; the identical run under `bash -p` printed `SAFE`, and with no `BASH_ENV` at all, `SAFE`. Round 64 narrowed it and round 65 corrected the narrowing, so both belong here. **Step 0a** (§ 4.23) makes the caller layer refuse on the *set-ness* of `BASH_ENV`/`ENV` before any ref is read, so this is no longer *neither* layer; what stays uncovered is a startup file that defines the function and then unsets the variable — undetectable by this instrument, not unreachable. And the sentence this cell used to end on — *the fence was never the terminal credential; the hook, which re-execs under `-p`, is* — holds only where the hook is **installed**. It is opt-in (`rules/git-workflow.md` § Push safety), so where it is absent the in-session approval is the whole credential and there is nothing stronger to defer to |
| **`GIT_EXEC_PATH`, selecting the `git` the gate itself asks** | **Caller: `-u GIT_EXEC_PATH`** in the same prefix | This is the reachable one, and it is a *name*, so the caller layer can strip it exactly as it strips `BASH_ENV`. The hook cannot: its only oracle for "which git is real" is answered by the git in question. Measured end to end on 2026-08-21 — see below |

**The `PATH` row has now been wrong twice, in opposite directions, and both times for the same
reason.** The first version said "not closed" and reasoned from `BASH_FUNC_git%%`; that was
refuted by measuring `GIT_EXEC_PATH`. The correction then overshot into "nothing was bypassed",
which is worse — it is the *conclusion* that inverted, not a detail: a hook that never runs because
the attacker's `git` chose not to run it is the definition of bypassed. Neither error came from a
missing measurement; both came from reasoning about the mechanism *around* the measurement that was
taken. What is measured now, and what each measurement does and does not license:

| Measured | Licenses | Does **not** license |
|----------|----------|----------------------|
| An evil `git` first on `PATH`; the hook resolved the real binary | "`PATH` does not choose the gate's own git" | anything about the process that *invokes* the hook |
| A `PATH`-first wrapper delegating with `--no-verify`; protected `main` updated, exit 0 | "a hostile `PATH` defeats the gate entirely" | that the caller layer can close it |

**Why `PATH` is not in the `env -u` prefix, stated as a boundary rather than an omission.** It
cannot be unset — every command in the fence, `git` included, is found through it — and there is no
trustworthy absolute path to substitute, because any source for one is reachable by whoever set
`PATH`. What makes that acceptable is not that the vector is small but that it is *strictly
larger*: a caller who writes `PATH` owns every command in the session, including the one that
would have printed the push plan and asked for approval. The named variables are different in kind —
each is a single name, unsettable at zero cost, and each is plausibly present in an ordinary session
for reasons that have nothing to do with an attack. That is the whole test for membership in the
prefix. What that test does **not** decide is a second question — whether the variable can change
*where the push lands* — and this paragraph used to answer it wrongly for the whole "transport set"
at once. `GIT_SSH_COMMAND`, `GIT_SSH` and `GIT_PROXY_COMMAND` are now in the prefix, because git
runs each of them as the connection itself; `GIT_ASKPASS` stays out, because it only returns a
credential. § 4.16 has the measurement and the boundary.

**The bypass, measured.** A `GIT_EXEC_PATH` pointing at a directory that mirrors the real git-core
and replaces only the `git` entry — with a wrapper that answers `merge-base --is-ancestor` with
exit 0 and delegates everything else to the real binary — makes the gate read a rewrite as a
fast-forward. The wrapper has to be that surgical: swapping the whole core breaks the push itself,
because git runs `pack-objects` through the same path.

```
# control, real git-core:      ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease origin feat/x
pre-push-gate: Force-form push rewriting ref(s): feat/x        -> exit 1

# same push, GIT_EXEC_PATH=<doctored core>
 + c6e12f2...dea2276 feat/x -> feat/x (forced update)          -> exit 0, no prompt

# same push, caller strips it: env -u BASH_ENV -u ENV -u GIT_EXEC_PATH …
pre-push-gate: Force-form push rewriting ref(s): feat/x        -> exit 1
```

An ordinary create and an ordinary fast-forward both still exit 0 under the stripping prefix, so the
fix adds a refusal and never widens one. The residual is stated rather than implied: a push made
outside `/push-ci` and `/epic-merge` carries no such prefix and is not covered — the same shape as
the exported-`BASH_ENV` residual two rows up.

**The configuration and the ancestry, measured the same way.** `GIT_EXEC_PATH` picks the binary the
gate asks; these two pick what that binary *answers with*. All three runs below are one repository
with the gate wired as `.git/hooks/pre-push` and `main` protected:

```
# control:            ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease origin main
pre-push-gate: Pushing to protected branch(es): main            -> exit 1

# same push, GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null
 + 4e2639a...8ea25b1 main -> main (forced update)               -> exit 0, no gate at all

# same push, GIT_GRAFT_FILE=<graft making the remote tip an ancestor>
   8ea25b1..4bc4728  main -> main                               -> exit 0, gate ran, asked nothing

# each of the two, with the caller's GIT_* prefix
pre-push-gate: …                                                -> exit 1
```

The two failures are different in kind, and the second is the one worth keeping in mind. The config
channel **removes** the gate: nothing runs, and the absence is at least in principle noticeable. The
graft leaves the gate installed and running, and corrupts the single question it asks — `git
merge-base --is-ancestor` returns 0, so a rewrite is classified as a fast-forward and the operator
is never prompted, exactly as they would not be for an ordinary push. A gate that is gone and a gate
that is wrong produce the same silence; only the second also produces a passing `doctor`.

**The two are closable at different layers, and only the configuration half is caller-only.**
Neither *configuration* channel is closable inside the hook, for the reason the `GIT_EXEC_PATH` row
gives one line up: the hook's only way to ask "is my configuration the real one" is to ask the git
that the configuration configures. Both *are* names, so the caller layer closes them, and
`test/skills/push-ci.test.js` and `test/skills/epic-merge.test.js` assert the clearing as a
**property** rather than only inside the byte pin — the pin is what a maintainer legitimately
regenerates, which is precisely how a clearing gets lost.

The **graph** channels are the opposite case: they are closable inside the hook, and they had to be,
because they are the only ones whose payload can sit in the repository rather than the environment.
The gate asks one topology question and git will answer it against a rewritten graph if the
environment or the repository says so — three channels, and unsetting is the wrong instrument for
two of them:

```sh
export GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1
unset GIT_REPLACE_REF_BASE
```

`unset GIT_GRAFT_FILE` restores git's *default* graft path, `$GIT_DIR/info/grafts`; unsetting
`GIT_NO_REPLACE_OBJECTS` restores git's default of *honouring* `refs/replace/*` — the r5 record
holds a whole round spent enabling that one by stripping the name. Measured 2026-08-21 in a real
repository with the gate wired and `main` protected: honest ancestry exits 1, a `.git/info/grafts`
naming the remote tip as a parent of an unrelated orphan makes it exit 0, and the round-46 form
(`unset GIT_GRAFT_FILE` plus `GIT_NO_REPLACE_OBJECTS=1`) **still** exits 0 — under it
`ALLOW_PUSH_PROTECTED=1 git push --force origin main` moved the remote tip to a commit sharing no
history with it, the rewrite gate never asking. That end-to-end run is not a one-off a reader has to
take on trust: `test/scripts/pre-push-gate.test.js` reproduces it whole under the name *the round-46
unset form wired as a real hook → a grafted rewrite moves the protected tip* — bare remote, the gate
installed as `.git/hooks/pre-push`, the graft written into `.git/info/grafts`, the exact push run
under both normalizations, and the remote tip read on each side. The scratch SHAs an earlier draft
quoted here were from a throwaway repository and named nothing anyone could look up; the test builds
its own. `ALLOW_PUSH_PROTECTED=1`
is part of that measurement rather than incidental: the protected-branch prompt is a separate
question and refuses first without it (measured — the same push without the variable is refused at
the protected gate). A graft defeats the rewrite question only. With `GIT_GRAFT_FILE=/dev/null` the
same push is refused and the remote tip does not move — and the refusal that fires first in *that*
run is the non-fast-forward one (`ALLOW_FORCE_WITH_LEASE` unset), which is the orthogonal earlier
guard `rules/git-workflow.md` § Push safety describes rather than the rewrite gate answering
correctly at last. Which gate refuses is not interchangeable, so the end-to-end test asserts the
refusal *by its message* rather than by the exit status alone — a refusal credited to the wrong
mechanism would read as the attestation working when it never ran. What the fix restores at that
point is the *answer*, ancestry back to 1; the attestation path that answer feeds is asserted where
it can be isolated, in the same file over the ref-line protocol with `ALLOW_FORCE_WITH_LEASE=1` set
so the earlier guard is out of the way.

Deliberately not normalized: `GIT_SHALLOW_FILE` and `GIT_ALTERNATE_OBJECT_DIRECTORIES`. They are
left alone for **two different reasons**, and collapsing them into one was wrong in the direction
that matters: truncating history can only make ancestry *unprovable*, the fail-closed side of the
gate's `!`, whereas supplying objects moves ancestry the other way — measured 2026-08-22, a repo
missing commit `R` answered `merge-base --is-ancestor L R` with **128** (`fatal: Not a valid commit
name`) and answered **0** with the donor's object directory added. Neither can manufacture a
containment that does not exist, and that is the whole security claim: objects are hash-addressed
and immutable, so a graph read out of an alternate store is the real graph — supplying it can only
**complete** an answer the gate could not otherwise reach, never falsify one it could.

Why this belongs in the hook rather than only in the six push prefixes: the prefixes cover pushes
this plugin issues, and the push that most needs the gate is the developer's own, which reaches no
skill. `test/scripts/pre-push-gate.test.js` pins all three forgeries, an honest fast-forward as the
positive control, two negative controls — the normalization stripped out entirely, and the round-46
`unset` form, which reopens the repository channel with every other test still green — and the
end-to-end case above, which carries both forms inside one test so the bypass and its closure are
measured against the same repository, the same graft and the same command.

**Three credentials in three rounds, and only the third one holds** (rounds 34–37; the content
that used to live as a comment block in `scripts/pre-push-gate.sh` before it crossed the 30-line
limit). The re-exec block is the gate's whole trust boundary, and what counts as *evidence that the
re-exec took* was wrong twice before it was right.

**Round 34 — argv[1], forged from the git config.** The first marker was the hook's own first
argument. argv[1] is the caller-chosen **remote name**, so `git remote add -- --gate-privileged
<url>` made the marker match on the first invocation and the re-exec never happened. Both authorized
skills hold `Bash(git:*)`, so configuring a remote is inside the threat model. P0.

**Round 35 — `$-`, and the verb it could not fix.** The replacement read the options the running
shell actually has:

```bash
case $- in
  *p*) ;;
  *) exec /usr/bin/env -u BASH_ENV -u ENV "${BASH:-bash}" -p "$0" "$@" ;;
esac
```

No remote name reaches `$-`, and that much was an improvement. What it did not fix is the **verb**:
deciding correctly and then acting through `exec` leaves the whole block answerable, because
**`exec` is a builtin and bash resolves functions before builtins**. Measured 2026-08-21: with
`BASH_FUNC_exec%%='() { return 0; }'` imported, `type exec` reports `exec is a function`, the
function runs, and execution **continues** — the block becomes a no-op and every `git` below it is
the pusher's. Baseline exit 1, injected exit 0. (`/bin/sh` is not affected: POSIX mode resolves
special builtins before functions, and `exec` is one. The gate does not run under `sh`.)

Three constructs survive an imported-function environment, and the block is now built from only
those: `case` (a reserved word, resolved by the grammar), `${x:?}` (fails during expansion, before
command lookup — rc 127 with both `:` and `exit` shadowed), and an **absolute path** (bash refuses
to import a function whose name contains a slash: `error importing function definition for
'/usr/bin/env'`). The third one is narrower than the first two and was read too broadly for two
rounds: it defeats an **imported** definition, not a **sourced** one, so it holds against the
environment and not against `$BASH_ENV` — see Round 52 below. Every abort is an expansion. Not a new invention: `scripts/commit-msg-guard.sh`
and `scripts/run-skill.sh` have carried the shape since the round that measured it there, and the
gate was simply never brought across — its own lesson, and why this names the two files rather than
restating their reasoning a third time.

**Round 37 — `$-` is not a credential either.** Fixing the verb left the discriminator still wrong,
and the cause is an ordering inside bash: `SHELLOPTS` is read *after* the environment, while `-p` on
the command line is read *before* it. So `SHELLOPTS=privileged` sets `p` without ever suppressing
the function import that privileged mode exists to suppress. Measured three ways on 2026-08-21:

| Invocation | `$-` has `p` | imported function |
|---|---|---|
| `env -u SHELLOPTS 'BASH_FUNC_f%%=…' bash script` | no | **present** |
| `env 'BASH_FUNC_f%%=…' SHELLOPTS=privileged bash script` | **yes** | **present** |
| `env -u SHELLOPTS 'BASH_FUNC_f%%=…' bash -p script` | yes | absent |

Row 2 is the forgery: `$-` reports exactly what row 3 — a genuine `bash -p` — reports, in a shell
that imported the attacker's function anyway. A preset `SD0X_PRIV_REEXEC` plus that variable skips
the re-exec and then passes the check that was supposed to catch a skipped re-exec.

**What ships: the argument count.** git's pre-push contract is exactly two arguments and nothing in
the environment changes that, so `$# >= 3` is reachable only through the script's own privileged
re-run, which appends three `--sd0x-privileged` sentinels. That re-run is an **ordinary command**,
not the `exec` builtin — `scripts/pre-push-gate.sh` says so at the call site and this document once
did not, having kept the word `exec` from the shape that preceded it. Both terminators were removed
for the same measured reason: `exec` and `exit` are builtins, and an imported `BASH_FUNC_exec%%` or
`BASH_FUNC_exit%%` answers them. The privileged pass therefore runs as a child and the hook's answer
is delivered by the script **ending** on it. Three, so one hop reaches `>= 3` from any starting count — git
gives 2, while 0 and 1 are reachable only by hand — and appending rather than prepending leaves
`$1` where it was. A forged marker now falls back **into** the re-exec rather than past it.

`SD0X_PRIV_REEXEC` survives as **paired state**, not as the credential, and is `unset` as soon as
the second pass begins. Left exported it is a denial of service on a legitimate setup: a descendant
started as an ordinary `bash <script>` inherits it, skips its own re-exec, has no `p`, and aborts.
That `unset` is the builtin for the reason it looks safe — our own re-exec ran, so nothing imported.

`$-` survives too, demoted to a **second-pass residual check** read for the property, never for
equality with a string, and asked *after* the privileged re-run has been entered — where its only
job is to notice a re-run that silently did not take. An earlier version of this document quoted `hpBc`/`hBc` as though the string
were the contract; those came from `bash -c`, the one form a hook is never run in. Measured: a bare
script gives `hpB`/`hB`, `-c` gives `hpBc`/`hBc`, and this repo's own hook reports `hpB` at the
check. It once reported `ehpuB`, and the difference is this file's own subject: round 36 moved
`set -euo pipefail` **below** the re-exec, so `e` and `u` are no longer set when `$-` is read. A
document that kept quoting the old string would be teaching the ordering that round removed.

Overclaiming in this table is not cosmetic — it produced the P0 below, and then produced this
correction, and then a second correction to the correction (§ 4.3's `PATH` row, twice wrong in
opposite directions). Every one of them was the same error: describing a mechanism from how it ought
to work rather than from what a command printed.

**Round 52 — the fix for a shadowed command was itself shadowable, twice.** Round 50 replaced
`exec /usr/bin/env …` with an ordinary command because `exec` is a builtin an imported function can
answer. What it left one line below was `exit $?`, and `exit` is a builtin an imported function can
answer. Measured 2026-08-22 on a protected-branch push the gate refuses with exit 1:
`BASH_FUNC_exit%%='() { builtin exit 0; }'` returned **0** — with the child's refusal still on
stderr, so the hook's own output said it refused a push git recorded as approved. A shadow that
merely `return`s falls through to the `${x:?}` fuse; one that terminates never comes back, and no
statement placed after the terminator can catch it. Same class as `exec`, one command later: the
round-50 fix was to the instance, not to the class.

What replaces it is **no terminator at all**. The rest of the file moved into the second branch of
the `case` that decides the pass, so the first pass's last executed command is the child launch, and
bash exits with the status of the last command it ran. There is nothing left to shadow: `case` is a
reserved word, resolved by the grammar rather than by command lookup.

**And the leading word was answerable after all.** The round-50 record and this section's own
absolute-path paragraph read the measurement `error importing function definition for
'/usr/bin/env'` as *a slash cannot appear in a function name*. It cannot appear in an **imported**
one; a definition **sourced** in the current shell may carry it. Measured:
`function /usr/bin/env { echo HIJACKED; }; /usr/bin/env true` prints `HIJACKED`. `$BASH_ENV` is
sourced before line 1, so a hostile environment could define exactly that and the re-exec's leading
word — the one command the whole block was built around not being shadowable — resolved to it.
Measured against the `#!/usr/bin/env bash` the file shipped with: a `BASH_ENV` file containing
`function /usr/bin/env { exit 0; }` returned **0 with no output at all**.

Nothing inside the file can defend, because `BASH_ENV` has already run when line 1 is read. The
shebang is the only statement early enough, and it now reads `#!/usr/bin/env -S bash -p`:

| Choice | Why not the alternative |
|---|---|
| `-p` | Privileged mode makes bash ignore `BASH_ENV`, `ENV`, `SHELLOPTS` and function imports outright — the same flag the re-exec already passes, moved to the one place that runs first |
| `-S` | A shebang takes a single argument, so without it the flag cannot be carried at all. BSD `env` and GNU coreutils >= 8.30. An older `env` fails the exec, git reports the hook as failed, and the push is refused — fail-closed |
| `env`, not `/bin/bash` | An absolute interpreter would pin macOS to bash 3.2 (§ 4.2) and break NixOS, where `/bin/bash` does not exist. Resolution stays where git would find it |

Measured after the change, on the same protected-branch push (baseline: honest run refuses, exit 1):

| Injection | Before | After |
|---|---|---|
| `BASH_FUNC_exec%%` returning, and exiting | exit 1 | exit 1 |
| `BASH_FUNC_exit%%='() { builtin exit 0; }'` | **exit 0** | exit 1 |
| `BASH_FUNC_[%%`, `BASH_FUNC_builtin%%`, `BASH_FUNC_command%%` | exit 1 | exit 1 |
| `BASH_ENV` defining `/usr/bin/env`, hook run through its shebang | **exit 0** | exit 1 |
| `ALLOW_PUSH_PROTECTED=1` (positive control) | exit 0 | exit 0 |

**The residual, stated rather than closed.** `bash <gate>` with a hostile `BASH_ENV` bypasses the
shebang and is still exit 0. That form is not one git uses — git `execve`s the hook file, and the
Husky stanza runs it as `bash -p` with `BASH_ENV` already stripped (`skills/codex-setup/SKILL.md`
§ The Husky stanza) — and a caller who chooses the interpreter can equally choose not to run the
hook. The stanza has a residual of the same shape one level up: its own first line runs in the
project's `.husky/pre-push` shell, whose shebang the project owns, so a `BASH_ENV`-defined
`/usr/bin/env` there answers the stanza before `bash -p` is reached. Neither is fixable from inside
this repository's files; both are recorded here so the next round does not read the shebang as
covering more than it does.

**Round 53 — the one caller the shebang cannot reach, refused instead of described.** The shebang
above defends the gate when the gate is *executed*. Sourcing it skips the shebang entirely, and with
it `-p`: the launch block then runs in the **caller's** shell, where a function named
`/usr/bin/env` can be defined by ordinary means rather than imported. The slash — which is illegal
in an imported function name and is what makes the absolute path defensive at all — buys nothing
against a definition that was never imported. Measured 2026-08-22: `function /usr/bin/env { exit
0; }` followed by `source` on a protected push returned **0 with no output**.

The fix is a refusal rather than a defence, and that is the whole of the reasoning: no supported
caller sources the gate. git `execve`s the hook file; the Husky stanza runs `bash -p -- "$gate"`.
So the form being closed was already outside what the gate supports, and closing it costs nothing a
real installation uses. It is written from the same two constructs as everything above it in the
block — `case` compares, `${x:?}` refuses during expansion — because a refusal made of `exit` or
`test` is answerable by exactly the channel it exists to refuse:

```sh
case "${BASH_SOURCE[0]:-$0}" in
  "$0") ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?pre-push-gate: must be executed, not sourced}" ;;
esac
```

Measured after: sourcing prints `pre-push-gate: must be executed, not sourced` and takes the
sourcing shell down with rc 127, while an executed gate still refuses the protected push at exit 1.
The refusal also lands *before* the gate's `set -euo pipefail` — an order, not a pair of line
numbers, since both move — which retires a second reason `skills/codex-setup/SKILL.md` used to give
for executing rather than sourcing: the `pipefail` leak it warned about has no path to reach.

**Round 54 — and the residual, because the round that added this construct also overclaimed it.**
The paragraph above once read "honest and hostile callers alike, since the refusal is decided
before either could act". That is false, and measured false on 2026-08-22: the refusal compares
`${BASH_SOURCE[0]}` against `$0`, and **in a sourced shell `$0` is whatever the caller says it
is** —

```
printf '<ref line>' | /bin/bash -c 'function /usr/bin/env { return 0; }
  . "$0" origin <url>; printf "SOURCE_STATUS=%s\n" "$?"' ./scripts/pre-push-gate.sh
# → SOURCE_STATUS=0
```

Nor is there a repair. `BASH_SOURCE` depth was tried and is not a discriminator either: executed
gives `count=1`, sourced from `bash -c '. "$1"'` gives `count=1`, and sourced with a forged `$0`
gives `count=1`. **In a sourced shell there is no value a hostile caller cannot forge**, so
detecting sourcing by inspection is not a thing that can be built — this is a property of the
construct, not a gap in this one.

That places the forged-`$0` bypass in the **same class as the residuals already recorded above** —
`bash <gate>`, and a hostile `BASH_ENV` — and the class has one shape: *a caller who chooses how to
invoke the gate can equally choose not to invoke it*. Neither supported caller can reach any of
them: git `execve`s the hook file through its shebang, and the Husky stanza runs
`bash -p -- "$gate"`. The refusal is kept for what it does reach — the accidental `source` in a
wrapper somebody wrote by hand — and it is described as that and nothing more. Anything stronger
would be a defence claim resting on a value the attacker supplies.

### 4.4 The fourth defect was in a test, and it was the worst of them

The discriminator that proved the gate tests run without a controlling terminal asserted
`NO_TTY` from a detached spawn — in an environment that has no controlling terminal to begin with.
Delete `detached: true` and it stays green in CI, while every gate test starts blocking on a
developer's own terminal waiting for a human. Green where nobody looks, hanging where somebody does.

The repair moved the helper into `test/scripts/helpers/detached-spawn.js` so a second node process
can load it, and the control now runs **that helper**, inside a real pty, both ways: the attached
form must find the terminal (proving the pty is real), the detached form must not (proving the
option is what removes it). Verified by deleting `detached: true` — the discriminator goes red,
where before it did not.

The general lesson, since it has now cost two rounds: **a precondition asserted in an environment
that satisfies it by accident is not a precondition.** Absence is not a signal — and a test that
cannot distinguish "the mechanism worked" from "the mechanism was never needed here" is reporting
the environment, not the code.



### 4.5 The gate was installed correctly and still never saw the refs

A fifth defect, and it is not in the gate at all — it is in the sentence that told an installer how
to wire it. `/codex-setup` mode 1 (Husky) wrote the gate into `.husky/pre-push`, a file the
project already owns, and the instruction was "append sourcing". Both words were wrong, each for an
independently sufficient reason:

| Word | What it costs | Measured 2026-08-21 |
|------|---------------|---------------------|
| **append** | git delivers the ref list on **stdin, once**. A consumer ahead of the gate takes it, and the gate then reads EOF — no refs, nothing protected, nothing rewritten | With a `while read …` loop ahead of it, a protected rewrite the gate refuses at exit 1 was allowed at **exit 0** |
| **sourcing** | `.`/`source` did not change `$0`, and the gate's privileged re-exec then read `exec … bash -p "$0" "$@"` — so under `source` it named **the Husky hook** | The parent hook's first line printed **twice** — `$-`=`hB`, then `hpB`: the project's entire `pre-push` re-ran under a privileged shell, and the gate never ran as the gate |

The second row is written in the past tense because the construct it turns on has since moved
twice, and quoting it as current would send a reader to a line that no longer exists. The re-exec's
word became `${BASH_SOURCE[0]:-$0}`, which resolves to the gate under `source` as well as under
execution; and the gate then closed the form off altogether — sourcing it now refuses, measured
2026-08-22 (§ 4.3, and `skills/codex-setup/SKILL.md` § The Husky stanza carries the same date).
Neither change weakens the row: what it records is why the *instruction* was wrong, and
prepend-and-execute is still the fix. It records a defect that no longer has a path to reach.

This is the same shape as § 4.1 and § 4.2 rather than a new one: a rule that is correct about the
thing it names and wrong about the set it lands in. "Append the gate" is right in a dedicated hook
file, where the gate is the only reader; it is wrong in a shared one. What makes it worse than the
others is that everything observable says it worked — the stanza is present, `doctor` resolves the
hook, git runs it, the gate executes and exits 0. The only symptom is a push that was not stopped,
which looks exactly like a push that did not need stopping.

The fix is prepend-and-execute, with the ref stream handed back so the project's own hook is not
starved in turn — the stanza is written out in `skills/codex-setup/SKILL.md` § The Husky stanza,
and `test/skills/codex-setup.test.js` extracts it **from that document** and runs it, so the
contract is executed rather than described. The negative control beside it reproduces the fail-open:
a harness that cannot produce the defect cannot witness its absence either.

**Round 35: the replacement stanza was the next instance of the same shape.** What went into
`.husky/pre-push` to fix the above reached the gate through six bare command words — `git`,
`cat`, `bash`, `mktemp`, `test`, `exec` — and a `pre-push` hook runs with the whole environment
of whoever ran `git push`. An exported `BASH_FUNC_git%%` is a shell function by the time line 1
executes, so each of those words was a decision handed to the pusher. Measured 2026-08-21 against
the round-34 stanza, with `git`, `cat`, `bash`, `mktemp`, `test`, `exec` and `exit` all
shadowed: a protected-branch push the gate refuses at exit 1 completed at **exit 0**, reporting
`* [new branch] main -> main`. Not a bypass of the gate — a stanza that never called it.

Every construct in the rewrite that runs **before** the verdict, or that **enforces** it, is one of
the three § 4.3 measures as immune (reserved word, `${x:?}` expansion abort, absolute path), and
everything else in that half runs inside `/bin/bash -p -c`, which imports no functions at all. The
qualifier is load-bearing rather than hedging: two bare words remain *after* `__sd0x_rc` holds the
verdict — `exec 0<` and `rm -f` — and the residuals paragraph below says what each costs when
shadowed. Stating the boundary is the point; an unqualified "no command words" would be the same
overclaim § 4.3 keeps catching, one file over. Two smaller defects surfaced with it, both the same
class one level down:

| Defect | Why it is the same shape |
|--------|--------------------------|
| Mode 1 wrote the stanza but no step ever **copied** `pre-push-gate.sh` to `.claude/scripts/` | The other three modes point git at the plugin's own copy, so the copy step was written as theirs. Mode 1 names a repo-relative path — correct for a hook, and true of no other mode |
| Modes 2–4 tested hook **identity** (`-ef`) and not executability | `githooks(5)`: a hook without the executable bit is ignored. "The right file is installed" is the right question about identity and the wrong one about whether git will run it |

The test that guards the stanza is a **positive-closure classifier**, not a prohibition list: every
logical line is matched against a closed set of permitted shapes, so a construct nobody thought of
fails by not being on the list. A blacklist of the words that were wrong this round is § 2's phrase
pin again, one file over. Its documented residual is pinned as an assertion rather than a hope —
under a shadowed `exec` the stanza refuses the push and **cannot** hand the ref stream back
(`TAIL-SAW 0`), because no POSIX construct reopens fd 0 without `exec`; the honest run keeps
`TAIL-SAW 1`.

`git push --no-verify` skips the hook outright and always has. That is not a gap this section
closes, and it is worth being plain about what the gate is for: an operator determined to bypass
their own tooling can, at any layer. What the gate stops is the cached in-session approval and the
absent-minded force push — the two cases where nobody *decided* to skip anything.

The exported-assignment residual is pinned as a passing test that asserts it still passes
(`test/scripts/pre-push-gate.test.js`). Pinning a weakness looks strange until you consider the
alternative: undocumented, it gets rediscovered as a fresh P1 every few rounds; asserted, a future
edit that closes it fails a test whose message says the docs now understate the defence.

### 4.6 Three ways to be right about a repository that is not the one changing

Round 46 closed three defects that share one shape: a check answered correctly, about something
other than the push it was authorizing.

**The gate asked about a graph the transfer does not send** — the account, the measurement and the
closer live in § 4.3, with the other ways the gate can be right about the wrong thing. It is named
here only because it is one of the three and round 47 corrected it twice: the fix was written as an
`unset` that reopened the channel it closed, and the measurement omitted the `ALLOW_PUSH_PROTECTED=1`
that made the push reach the rewrite gate at all.

**The probes read the fetch URL while the push contacted the push URL.** `origin` names two
destinations. `skills/epic-merge/SKILL.md` classified topology with `git ls-remote origin` at both
its iteration and rollback gates and then force-pushed to `origin` — repository A classified,
repository B rewritten, with the unshared attestation collected for neither. Both probes now resolve
`git remote get-url --push --all origin` and look the tip up at that URL, fail-closed on anything
other than exactly one (`pushurl` is multi-valued and git pushes to every one of them). This is the
same fix `/push-ci` took a round earlier; what round 46 added is that it was only ever half a fix
while the sibling skill kept the old shape.

**The destination was resolved once and used later.** `/push-ci` Phase 2 re-derives the branch and
the HEAD commit and compares each against what the plan showed; the destination was not in that set,
so a `pushurl` change between the approval and the push would redirect the approved commits with
every other assertion still true. Phase 2 now carries `PLAN_PUSH_URLS` and refuses on disagreement or
on a destination that will not resolve — the same treatment, for the third of the three things an
approval fixes. `/epic-merge`'s two force-push fences carry the equivalent re-assertion against the
URL its per-iteration approval named.

**Round 55: what that re-assertion is, and what it is not.** It has now been proposed twice that the
push simply address the *validated URL* instead of the mutable name `origin`, which would make the
comparison unnecessary. Measured 2026-08-22, and recorded here so it is not proposed a third time:
with `url.<B>.insteadOf=<A>` configured, a push whose destination argument is the literal URL `<A>`
— no remote name anywhere on the line — lands the ref in **B**. git applies the rewrite layer to a
command-line URL exactly as it applies it to a remote name, so addressing the URL relocates the
re-resolution from one config key to another and pins nothing. The `--set-upstream` breakage
recorded for the SHA-refspec alternative is a second reason, not the first one.

The same run settles the other half, in the reassuring direction: `git remote get-url --push --all
origin` reports the **post-rewrite** URL, so what Phase 0 hashed is the destination git would really
use — the oracle is not reading a pre-rewrite value and calling it the answer.

What is left cannot be closed **by naming a destination**: git resolves it inside its own process,
from configuration this shell cannot freeze, and every construct that names one — a remote, a URL,
a SHA refspec — goes through the same rewrite layer. The re-assertion is therefore a **window
narrowing**, not a pin: it sits in the same fence as the push with no question in between, so what
it narrows is the window that actually existed (the approval is minutes and several tool calls
away; the re-read is microseconds away).

**Round 56 correction: this paragraph said "irreducible client-side", and that was false.** The
resolution is client-side, but it is not unobservable. git computes the destination it is about to
reach and hands it to the pre-push hook as `$2` — inside the pushing process, after every rewrite.
The gate had that argument all along and did not read it: `scripts/pre-push-gate.sh` carried the
line `# $2 is remote URL (unused)`. The false claim was load-bearing in the worst direction — it
told a reader the residue was a fact of the client rather than an unread argument, which is exactly
the reading that stops anybody from closing it.

Measured 2026-08-22 (git 2.55.0), and the measurement is what makes a binding possible rather than
merely plausible:

| Push | `$1` | `$2` |
|------|------|------|
| `git push origin`, no rewrite | `origin` | `<A>` |
| `git push origin`, `url.<B>.pushInsteadOf=<A>` | `origin` | `<B>` — the rewritten one |
| `git push <A>`, `url.<B>.insteadOf=<A>` | `<A>` — pre-rewrite | `<B>` — post-rewrite |

`$1` is therefore not the destination and never was; `$2` is. And hashing `$2` equalled hashing
`git remote get-url --push --all origin | head -1` byte for byte in every row above, which is what
lets the caller compute the expected value from the same bytes the gate will see.

**The digest is SHA-256, and round 56 got that wrong.** The first version used
`git hash-object -t blob --stdin`, which is SHA-1 in a repository of the default object format.
`rules/security.md` prohibits SHA-1 *for security*, and this digest is a security decision: the
adversary the binding exists to stop is one who edits `.git/config` between the approval and the
push, which is exactly an adversary in a position to choose the second input. Chosen-prefix
collisions against SHA-1 have been practical since 2019, so the prohibition is not ceremonial here.

`hash-object` also follows the *repository's* object format — measured 2026-08-22 (git 2.55.0):
`https://example.invalid/x.git` digests to `b354136a…` in a default repository, `7524f1f0…` in one
created with `--object-format=sha256`, and back to the SHA-1 value when run outside a repository
altogether. **Round 58 corrects how much that second point carries.** It was written here as an
independent breakage — "the two sides of a comparison that must agree byte for byte" — and it is
not: both sides run in the same repository, so both read the same format and agree. It matters in
one narrower case, the run that happens outside a repository and silently falls back to SHA-1, and
as a reason not to build a cross-process binding on a tool whose algorithm is chosen by ambient
state. The Anchor Register #1 hit is what made the change mandatory; this is why a different tool
was chosen rather than `hash-object` with a format flag.

The gate and both skills now hash with the first available of `sha256sum`, `shasum -a 256`,
`openssl dgst -sha256`, and **verify the shape** (64 lowercase hex) before believing the answer: a
present-but-broken tool — `shasum` whose perl lacks `Digest::SHA` — exits nonzero with a diagnostic
on stdout, and without the shape check that diagnostic silently becomes the digest.

**Round 58: a shape check is not a correctness check, and the gate now says which it has.** Sixty-
four hex characters is exactly what a *lying* tool emits too, so the gate runs a known-answer test
first — the empty string must digest to `e3b0c442…b855` and `abc` to `ba7816bf…15ad` — and refuses
the bound push when it fails, with a diagnostic naming the tool rather than the destination, since
that is what the refusal is actually about. What the KAT does **not** close is an input-aware shim
that answers correctly for those two vectors and lies for a URL; saying so is part of the fix rather
than a caveat on it. It raises the floor from "any tool on `PATH`" to "a tool that agrees with
SHA-256 on two known inputs".

Which is the moment to state a precondition the digest work quietly assumed. `bash -p` closes the
imported-function channel and nothing else: every check in `scripts/pre-push-gate.sh` — the digest
tools, and `git merge-base` for the history-rewrite class — runs a binary resolved through `PATH`.
`PATH` integrity is therefore a precondition of the **whole gate**, not a property the binding
establishes. The header comment says this now; it previously implied the re-exec had settled it.

**A set, not a value, and round 56 got that wrong too.** Measured 2026-08-22 with two `pushurl`
entries on one remote: git invokes the pre-push hook **once per push URL**, each time with that
single URL in `$2` — `$1=origin`, `$2=<A>`, then `$1=origin`, `$2=<B>`. A binding carrying one
digest of the newline-joined list therefore matches neither call, and because the binding is
fail-closed it refused *both* halves of a fan-out the operator had configured and approved. The
variable now carries one digest per approved destination, whitespace separated, and membership is
the test. That is not a weakening: the operator approved every URL the plan showed, so any one of
them is a destination the approval covered.

**The URL does not decide where the objects land.** Measured 2026-08-22, and this is the sharpest of
the three: with `remote.origin.receivepack` pointing at a program that execs `git-receive-pack` on a
*different* repository, an ordinary branch push printed

```
To <A>
 * [new branch]      main -> main
```

while every object landed in `<B>` and `<A>` stayed empty. `$2` is `<A>` throughout, so the digest
matches and attests to nothing — git's own success output names the repository that did not change.
Two spellings reach this: the config key, which an edit between approval and push can set, and
`--receive-pack` / `--exec` on the command line, which no hook can see. The config spelling is
refused by the gate whenever the binding is active and by both skills before they ask for approval
(the absent-gate case — `git-workflow.md` § Push safety moves the question rather than deleting it);
the command-line spelling is closed by the skills never emitting it, pinned by their own tests.

**Round 58 measured three things about that paragraph, and one of them makes the config half weaker
than it reads.** git runs the pre-push hook only *after* the ref advertisement, so the transport is
already selected by the time the gate can read `remote.<name>.receivepack`. A wrapper that runs
`git config --unset remote.origin.receivepack` and then execs the redirected helper leaves the gate
seeing the key unset, git reporting success against `<A>`, and every object in `<B>`. The config
check is therefore **best effort** — it catches a configured redirect left in place, which is the
shape an edit-between-approval-and-push actually takes, and not one that erases itself. The gate's
comment says this at the check rather than only here.

The command-line half moved the other way — from irreducible to closed, and by the same mistake
round 56 made about `$2`: an unread argument. Measured 2026-08-22, pushing into two bare
repositories with a configured `receivepack` pointing at the second: `-c
remote.origin.receivepack=git-receive-pack` does **not** override it — git prints `error: more than
one receivepack given, using the first` and keeps the configured value, objects still landing in
`<B>` — while `--receive-pack=git-receive-pack` and `--exec=git-receive-pack` on the command line
**do** override, with the objects landing in `<A>`. So a skill can pin its own push against a
redirect it cannot otherwise see. All four `/push-ci` push forms and both `/epic-merge` ones now
carry `--receive-pack=git-receive-pack` literally, placed **after** the force flags so
`git push --force-with-lease` stays the literal head of the line the Anchor grant in
`@rules/git-workflow.md` § Exception is audited against; their tests pin both the presence and the
value, and forbid `--exec` and any non-canonical `--receive-pack=` value outright.

Two smaller corrections from the same round. The gate classified `$1` as a remote name by pattern —
anything not looking like a URL — which skipped the config lookup for a valid remote whose name
contains a slash: `git remote add foo/bar <url>` is accepted and `remote.foo/bar.receivepack` is
honoured. It now asks `git remote` for the list and matches whole, so the classifier answers from
the repository instead of from a guess about spelling. And the refusal printed the configured
`receivepack` value; it now prints the key and the command to read it
(`git config --get remote.<name>.receivepack`), because that value is operator-supplied and a
refusal message is not a place to publish operator-supplied strings.

**The binding: `SD0X_PUSH_DEST_DIGEST`.** The four `/push-ci` push forms and the two `/epic-merge`
ones set it inline to the `PUSH_URLS_DIGEST` their approval covered; the gate refuses when `$2`
hashes to anything else. Three properties, and each is why it was safe to add to a hook consuming
projects already install:

| Property | What it means |
|----------|---------------|
| Monotone | Unset or empty ⇒ the gate behaves exactly as before. It can only ever add a refusal, never authorize a push — the same shape as `--force-if-includes`, which this file already praises for it |
| Fail-closed | Set but unverifiable ⇒ refuse: no `$2`, no SHA-256 tool, an answer that is not 64 hex characters, or a configured `receivepack`. A binding that passes when it cannot check is not a binding |
| Not an attestation | It says "the destination did not change since the approval", never "a human approved". It substitutes for neither `/dev/tty` prompt and skips neither, so it changes nothing in the credential-selection contract of `rules/git-workflow.md` § Push safety — that clause is about who authorizes, and this is about where the objects go |

It is also the opposite direction from `ALLOW_PUSH_PROTECTED` / `ALLOW_FORCE_UNSHARED`, which is why
it sits on the push line those two are cleared on. Those are operator attestations, so a skill
setting one answers its own question; this is a constraint the skill puts on itself, so a skill
*not* setting it leaves the check in one process and the push in another. Setting it inline is also
what stops an inherited value from deciding.

Wired end to end 2026-08-22: with the gate installed and the approval covering `<A>`, a push
redirected to `<B>` by `pushInsteadOf` was refused and `<B>` received nothing; the same push
carrying `<B>`'s own digest went through, so the check is an equality and not a blanket refusal;
and with the variable unset the push proceeded silently, which is the monotonicity row. Round 57
added three more, each against a real push into real bare repositories: a two-URL fan-out with both
digests approved reached both destinations, with only the first approved reached only the first,
and with the joined-list digest reached neither; a configured `receivepack` was refused with
nothing landing anywhere, while the same push without the binding landed in the unnamed repository;
and a digest tool replaced by one that answers with a diagnostic refused the bound push while
leaving an unbound push untouched.

One residue is left, and stating it precisely is the same duty this paragraph failed at last round.
The binding closes destination *resolution* — it does not make the gate run. Three states leave it
inert, and only the first has an operator fix: the gate is **opt-in**, so where it was never
installed the destination check is back to the in-fence re-read alone
(`/codex-setup sync --with-push-gate` is the fix "irreducible" did not have); `core.hooksPath` can
be repointed, or `--no-verify` passed, so the hook never executes. The second and third are not
holes this binding could have closed by trying harder: an adversary who can rewrite local config
mid-push can also replace the hook file itself, so pinning the hooks path would buy nothing, and
`--no-verify` is the caller's own argv — closed by the two skills never emitting it, pinned by
their tests, exactly as `--receive-pack` is. What the binding removes is the class where every
component behaves honestly and the objects still land somewhere the approval never named.

**Round 48: naming the destination everywhere published whatever the destination carried.** The
three fixes above all end in the same place — the destination becomes a value the operator reads and
an approval is compared against. `git remote get-url --push --all` returns it verbatim, credentials
included, and git hands the hook the URL itself as `$1` whenever the push names no remote, so both
of the gate's `/dev/tty` prompts printed it too (measured 2026-08-21). Three components are now
masked wherever a destination is displayed or compared — userinfo split at the **last** `@` inside
the authority, since git parses it that way and the first `@` leaves the tail of a password behind,
plus query and fragment, because `?access_token=` is a credential no userinfo mask reaches. One
transformation, byte-identical at the six `PUSH_URLS_SAFE` sites and reproduced in
`scripts/pre-push-gate.sh`; the skill tests execute one copy and assert the rest are the same bytes,
which is what makes executing one of them evidence about all six. What redaction costs is stated
rather than waved away: two destinations differing only inside a masked component read alike — for
userinfo that merges two credentials for one repository and never two repositories, while for query
and fragment the loss is real on a host that identifies the repository by parameter. Scheme, host
and path are never masked, so the redirect § 4.6 exists to catch is still visible.

**And the classifier that decided all of this was a markdown table.** The six-row reading table in
`/push-ci` Phase 0 was the only statement of the decision, so the property it turns on had no
behavioural test: `merge-base --is-ancestor` answers in three readings — 0 contained, 1 not
contained, **anything above 1 an error rather than an answer** — and `if ! git merge-base …`
collapses the last two into the **same asking branch**, so an errored ancestry is reported as a
*measured* rewrite. The `ASK` bit survives that collapse; what it loses is reason fidelity, and the
reason is what the operator is asked to answer. The classifier is now an executable fence producing `ASK`
and `ASK_REASON`, with the table documenting it rather than replacing it. Seven inputs are executed;
two mutants are asserted applied before their effect is read — delaying the status capture by one
command (every ancestry outcome collapses to `fast-forward`), and collapsing the three readings to
two (an errored `merge-base` reports `rewrite`, telling the operator a rewrite was *measured* when
nothing was). The `ASK` bit survives that second mutation; only the reason reveals it, which is why
the reason is carried into the prompt.

**Round 49: a value referenced everywhere, computed nowhere the approval could see it.** The plan
line requires the destination Phase 0 derived — and until this round Phase 0 derived nothing. Both
`PUSH_URLS_SAFE` derivations sat inside Phase 1's `--force-with-lease` branch, so every ordinary
push reached Phase 2's comparison with a value no approval had shown. The fix is a Phase 0 step that
derives it unconditionally, before any question is asked; the test for it is **positional**, because
the defect was — it reads the `### Phase 0` and `### Phase 1` headings and asserts the derivation
falls between them, with a negative control that removes only that copy and leaves the later ones
standing, since a presence check stayed green on the shipped defect.

**The same round produced a fix that its own tests rejected, and that rejection was correct.**
`/epic-merge`'s rollback leases against `refs/remotes/origin/<head>`, which cannot express "this
ref must not exist yet" — so the row the classifier calls a permitted creation could never publish
(measured: `stale info`). Selecting the lease form through a variable — `git push "$LEASE"` —
fixed that and broke something worth more: three tests that enumerate what this document tells
Claude to execute read the line as a bare `push`, because a flag behind a variable is invisible to
static reading, human or mechanical. The Anchor grant in `@rules/git-workflow.md` § Exception names
`git push --force-with-lease`; auditing that grant depends on every push form staying literal at
its call site. So the push line stayed as it was and the classifier row changed instead: a deleted
head is reported and handed back, exactly like the row where the remote already holds the backup.
The form that would work is not on the grant, adding it is an Anchor-level question rather than an
implementation detail, and re-publishing a branch somebody else deleted was never the rewrite
rollback was asked to undo. The git semantics both halves rest on are pinned as an oracle test
rather than asserted in prose — value-less lease on a deleted branch refuses, the empty expectation
recreates it, and it refuses again once the branch is back.

### 4.7 The word that decides is a builtin, and a builtin can be replaced

Round 54. Every guard in `/push-ci` Phase 2 and every classifier in `/epic-merge` was written with
`[ … ]`. `[` is a **builtin**, and bash resolves an imported function of that name ahead of it.
Measured 2026-08-22, on `/bin/bash` 3.2 and on bash 5.3 alike:

```
env 'BASH_FUNC_[%%=() { return 1; }' bash -c 'type -t "["; if [ a = a ]; then echo TRUE; else echo FORGED; fi'
# → function
# → FORGED
```

So a caller who can set one environment variable answers *every* predicate in those fences: the
branch guard, the HEAD guard, the destination guard, the ancestry classifier. The push then runs
against a branch, a commit and a repository the approval never covered, with each comparison
reporting agreement. This is the same shape as the round-39 `BASH_FUNC_env%%` finding — a command
word without a slash is a name the environment can bind — reaching a construct nobody had counted
as a command word.

**`[[` and `case` are reserved words**, resolved by the parser before command lookup, and no
function can shadow them. Both were measured immune under the same forgery. Every `[ … ]` inside an
executable fence in both skills moved to one of them — not only the sites the finding named, because
the ones it did not name are the same class and would be the next finding.

**Which one, and why it is not a style choice.** String and emptiness tests became `[[ … ]]`, with
the right-hand side quoted so it stays a literal rather than a glob. Arithmetic tests did **not**:

| Input | `[ "$X" -eq 0 ]` | `[[ "$X" -eq 0 ]]` |
|-------|------------------|--------------------|
| `X=` (empty) | error → **false** | **true** |
| `X=a` with `a=7`, compared against 7 | false | **true** — operands are evaluated as arithmetic *recursively*, so a non-numeric one is dereferenced as a variable name |

Both differences go the wrong way here. An empty ancestry reading as 0 publishes `no-rewrite` and
skips the unshared attestation — fail-closed inverted by a respelling. So the exit-status readings
became `case`, whose `*` arm catches the empty string with every other unexpected value and lands
it in the errored reading by construction rather than by a predicate someone has to remember.

**The test doubles had to be fixed before they could witness any of this.** Both fakes were
`#!/bin/sh`, which on macOS is bash in posix mode and imports `BASH_FUNC_*` exactly as bash does.
Under the forgery they answered nothing, the fence refused an empty branch, and the first version of
the guard test passed — reporting a broken fixture as a working guard. A double has to be immune to
the thing under test before it can measure it; both now decide with `case`.

Each skill carries a guard test that runs the forgery three ways, because one direction proves
nothing: the shipped fence must still refuse, the same fence respelled with `[` must let the
unapproved push through (`refs/heads/feat/somewhere-else` reaches the recorder), and a lawful run
under the identical hostile environment must still succeed.

**Round 59: the report channel is part of the verdict.** Every predicate in those fences was now
keyword-immune, and the verdict then left through `printf` — a **regular builtin**, which an imported
function outranks exactly as it outranks `[`. Measured 2026-08-22, on a fence whose real variables
were `ASK=1` and `ASK_REASON=rewrite`:

```
BARE: ASK=[] ASK_REASON=[fast-forward]
ABS:  ASK=[1] ASK_REASON=[rewrite]
```

The bare form let the caller write the answer the fence had just measured correctly, and `/push-ci`
would then skip the unshared attestation on a push that rewrites history. The keyword discipline
above bought nothing while the report was forgeable — which is why the fix is **on the report**, not
on another predicate: **every** site in the two skills now spells it `/usr/bin/printf`. Counted
2026-08-22 with `grep -n '/usr/bin/printf'`, discounting the comment lines that merely quote the
spelling: 20 invocations on 19 lines — five classifier reports (`/push-ci` Phase 0, its `ASK`
classifier and the Phase 2 final re-check § 4.11 added; `/epic-merge`'s iteration and rollback
fences), six digest blocks at two calls each, and `/epic-merge`'s iteration-count line, which
carries two on one line. bash refuses to import a function
whose name contains a slash — `error importing function definition for '/usr/bin/printf'` — so the
absolute path is not a name the environment can bind.

**What the absolute path costs, stated honestly.** An earlier draft of this section wrote that
`/usr/bin/printf` "is part of every POSIX layout". That is false, and round 61 caught it against
this document's own § 4.3, whose interpreter row rejects an absolute `/bin/bash` precisely because
NixOS does not have one. POSIX standardises the *utility*, never the *pathname*; `getconf PATH` on
this machine returns `/usr/bin:/bin:/usr/sbin:/sbin`, which says where the standard utilities live
**here**, not everywhere. The claim this section can actually support is narrower: `/usr/bin/printf`
exists on macOS (101808 bytes, `root:wheel`, measured) and on mainstream Linux distributions — and
on the one layout § 4.3 already names as an exception it does not, since NixOS populates `/usr/bin`
with `env` alone. `/epic-merge`'s `/usr/bin/diff` carries the same contract. The canonical `env`
prefix is unaffected, and for that same reason: `/usr/bin/env` is the path NixOS does provide.

The path stays, because every alternative reintroduces the defect: any scheme that *resolves* the
utility at runtime resolves a **word**, and a word is what an imported function replaces. What
changes is the claim. On a layout without these paths each consumer fails **closed**, which is why
this is a documented platform contract rather than an outstanding defect: `sha256_raw` returns
empty, so the digest is empty and the destination guard refuses (§ 4.10); the classifier fences
print no report at all, so nothing downstream reads a forged one; and the manifest comparison's
`if ! /usr/bin/diff` treats an absent utility exactly as a mismatch — it restores from the backup
tag and refuses to push (§ 4.12). None of them proceeds on silence.

The lesson generalises past `printf`: a fence is only as trustworthy as the **whole path** from
measurement to the reader, and the structural tests in both skills now require the absolute spelling
rather than merely a report line, so a respelling back to the builtin is a red test.

### 4.8 Installing a guard by deleting one

The opt-in flag is a request to *add* a push gate. Round 58 found the install path could honour it
by destroying the operator's own hook: in modes 2–4 (`core.hooksPath`, `.git/hooks/` direct, the
`.githooks/` fallback) `/codex-setup` writes the gate **as** the resolved `pre-push` file, and
`skills/codex-setup/SKILL.md` Phase 3 said nothing about what was already at that path. A project
with its own `pre-push` — the only thing standing between it and something this skill knows nothing
about — lost it, irreversibly, to a command asking for more safety.

The ownership vocabulary already existed one section away: `uninstall` deletes a hook file "only
after verifying it is sd0x-owned". The check simply was not stated on the side where the file is
still there to protect. Phase 3 now classifies the destination **by content, never by existence** —
absent or empty ⇒ write; sd0x-owned ⇒ overwrite, which is what `sync` is for; anything else ⇒ do
not write, record `pending`, and report which file to move.

Two choices in that row are worth stating rather than leaving to be re-derived:

| Choice | Why |
|--------|-----|
| The marker is a line prefix (`# pre-push-gate.sh - `), not a byte-for-byte match | A byte match refuses every *past* shipped version — the one case a refresh most needs to succeed on. A hand-edited header stops matching and the install refuses; a foreign file matches only if someone copied our header into it. Refusing costs a re-run and names the file; clobbering costs a hook nobody can get back |
| A refused write records `pending`, not `declined` | The operator opted in and the wiring did not finish, which is what `pending` already means; the transition matrix treats it as a gate to keep, so a later `sync` retries. `declined` would turn their request into an opt-out they never made |

`test/skills/codex-setup.test.js` pins both halves, and the second test is the one that earns its
place: it **parses Phase 3's `sd0x-owned` row** for all three parts of the predicate — the marker
template (the backticked literal containing `<script>`), the window (`first 20 lines`), and the two
script names — and then asserts both shipped scripts actually carry the marker so instantiated.
Reword a header and the predicate starts refusing to overwrite our own installed copy — the safe
direction, but silently, and this turns that into a red test instead of a support ticket.

Two negative controls, and they guard different things. The first checks the gate does not match the
guard's marker or a foreign script name, since a prefix test loose enough to match everything would
satisfy the positive half. The second — added in **round 59**, when the test still hard-coded
`` `# ${script} - ` `` in its own file while this paragraph claimed it read the skill — re-parses the
row with the marker reworded and asserts nothing matches the reworded form. A hard-coded marker sails
through that unchanged, so it is the control that makes "read out of the skill" a testable claim
rather than a description. The fix was to make the test true, not to weaken the sentence.

### 4.9 A prediction is not a measurement

Round 59, `/epic-merge` bundled mode. Whether the unshared attestation was owed was decided **before
Step 2** — and Steps 2 and 3 then check out the remote-tracking ref and rebase it, which are exactly
the two operations that determine what the eventual push overwrites. So the decision was made about
a topology that no longer existed by the time it was acted on. § Safety already recorded the outcome
in the other direction: a collaborator commit checked out locally and dropped by the rebase is
overwritten with exit 0, past both leases.

The fix is not a better prediction. Step 5 **re-measures** immediately before the push, inside the
same fence, and refuses anything it cannot read as benign:

```sh
case "$FINAL_READING" in
  creation|up-to-date|fast-forward) ;;
  *) echo "⛔ post-rebase topology reads '${FINAL_READING}' …" >&2; exit 1 ;;
esac
```

The refusal is a `case` over the word with a `*` catch-all rather than a negated list, for the same
reason § 4.7 gives: a reading nobody has written yet lands in the refusing arm **by construction**.
The test executes that arm rather than reading it — the three benign words exit 0, and `unknown` and
`something-nobody-wrote-yet` exit 1. It must also live in the **same fence** as the push and appear
before it: a re-check in a separate block measures a tree the push never sees, and the structural
test asserts both the co-location and the ordering. The `rewrite` arm was refusing here too until
round 60 corrected it — § 4.13 says why refusing it outright was the wrong shape.

### 4.10 Select the hasher, then feed it

Both skills digest their push URLs so that a destination change is decidable after redaction deletes
the query string. The digest was computed like this:

```sh
printf '%s' "$U" | { sha256sum || shasum -a 256 || openssl dgst -sha256; }
```

A pipeline hands its stdin to the **whole brace group**, and a `||` chain does not rewind it. So the
first command reads the input and only then fails, and the fallback hashes what is left: EOF. Every
URL therefore digests to the SHA-256 of the empty string, and — this is the part that matters — they
are then **equal to one another**. A guard whose only question is "did the destination change?"
answers no on a destination that changed.

Measured 2026-08-22 under `BASH_FUNC_sha256sum%%=() { cat >/dev/null; return 1; }`:

| Input | Old pipeline | Selection-first |
|-------|--------------|-----------------|
| `https://gw.example/push?repo=A&token=one` | `e3b0c442…7852b855` | (empty — refuses) |
| `https://gw.example/push?repo=B&token=two` | `e3b0c442…7852b855` | (empty — refuses) |

An exported shell function is the sharp version of this, but nothing about the defect needs an
attacker: a `sha256sum` shim that reads and fails produces the same collision by accident.

The fix separates the two questions. `command -v` **does not read stdin**, so choosing the tool and
running it are no longer the same act, and the chosen tool is fed exactly once:

```sh
DIGEST_TOOL_OK=
if command -v sha256sum >/dev/null 2>&1; then DIGEST_TOOL_OK=yes
elif command -v shasum   >/dev/null 2>&1; then DIGEST_TOOL_OK=yes
elif command -v openssl  >/dev/null 2>&1; then DIGEST_TOOL_OK=yes
fi
```

Selection alone is not enough, because a tool can be present and lie. A **known-answer test** on two
fixed vectors runs before any URL is hashed; a hasher that answers one well-shaped 64-hex constant
for every input passes a shape check and fails this one. Either failure empties the whole digest
variable rather than emptying one entry — an absent digest is a refusal, whereas a per-URL blank
would read as "this destination has no digest" beside destinations that do.

Six copies of the block exist across the two skills (§ 4.7 counts them). The tests extract every
copy and assert they are **byte-identical**: two divergent copies both read as "the digest block"
while one of them is weaker.

### 4.11 The same prediction, on the other skill

§ 4.9 fixed `/epic-merge`. `/push-ci` had the identical shape and round 60 found it: Phase 0
classified the remote topology and decided from that whether the unshared attestation was owed;
Phase 2 pushed. Between them sit an AskUserQuestion, a different shell, and everything a remote can
do while the operator reads a plan.

Phase 2 now re-measures inside the push fence, under the same `case`-with-`*` discipline, and — like
§ 4.13 — the `rewrite` arm is **attestation-gated rather than refusing**: a rewrite is what
`--force-with-lease` exists for, and refusing it would break the only workflow that needs the flag.

Two properties the tests assert rather than assume:

| Property | Why it is not obvious |
|----------|----------------------|
| `unknown` refuses **even with an attestation in hand** | The attestation answers *is this ref shared*; `unknown` says the *measurement* failed. No answer to the first is evidence about the second — and the push binds its lease to a tip that, here, was never read |
| The re-check does not run at all on a plain push | Without the flag git refuses a non-fast-forward client-side, before the hook is invoked. Running the reads anyway costs two network round-trips on the commonest path and — worse — could refuse a push git was going to reject by itself, reported as though this skill had made a safety decision |

### 4.12 A step whose exit status nobody reads is not a step

`/epic-merge`'s per-PR loop ran Steps 2, 3 and 4 as bare commands. A failed checkout, an interrupted
rebase, or a manifest that could not be written all continued into Step 5 — which force-pushes. The
manifest comparison was worse than unread: `# Mismatch → STOP + restore` was a **comment** under a
bare `diff`, so a mismatch printed its diff and the fence pushed the branch anyway.

Each is now `if ! <command>; then <what is no longer true>; exit 1; fi`, and the comparison calls
`/usr/bin/diff` by absolute path for the § 4.7 reason — `diff` is a command word an imported
`BASH_FUNC_diff%%` outranks, so a forged exit 0 would be just as unread as no test at all. On a
mismatch the branch is restored from its backup tag, and when the **restore** also fails the operator
is told the tree is in neither state, which is the one outcome where doing nothing further is right.

The tests execute these guards with a recording `git` on `PATH` rather than reading them: a failing
step exits 1 and names the decision, a succeeding step falls through silently, a mismatch restores
and pushes nothing, and matching manifests proceed without restoring. That last case is the negative
control — a guard that refused unconditionally would satisfy every other assertion here and break the
skill outright, which is a failure this very round produced once.

### 4.13 Refusing a rewrite the operator already attested

Round 59 gave `/epic-merge`'s Step 5 the `case` above with `rewrite` in the refusing arm. That is
wrong for this skill, and the wrongness is not a severity judgment: `/epic-merge` **exists** to
rebase a stacked chain and force-push the results, so every ordinary iteration reads `rewrite`. A
refusal there is not a stricter gate, it is a broken skill.

The correct shape distinguishes *what the topology is* from *whether anybody attested to it*:

```sh
case "$FINAL_READING" in
  creation|up-to-date|fast-forward) ;;
  rewrite)
    if [[ "$UNSHARED_ATTESTED" != "refs/heads/${head}" ]]; then echo "⛔ …" >&2; exit 1; fi ;;
  *) echo "⛔ …" >&2; exit 1 ;;
esac
```

The predicate is `[[ ]]`, and in this document that is not a stylistic preference: § 4.7's own
threat model says a word can be replaced, and round 61 measured how far that reaches — under an
imported `BASH_FUNC_true%%`, `BASH_FUNC_false%%` or `BASH_FUNC_exit%%` declaring `return 7`, each of
`true`, `false` and `exit` returned 7. `[` is a builtin and falls the same way; `[[` is a **keyword**
resolved by the parser before any name lookup, and is the only form here that cannot be replaced.
The example above was written with a bare `[ … ] || { … }` until round 61 caught it — a document
whose argument is "the word that decides can be replaced" demonstrating the replaceable word.

Three properties, each of which a shorter form loses:

1. `UNSHARED_ATTESTED` is assigned **unconditionally in-fence with an empty default** and is never
   read from the environment. A value exported earlier in the shell would answer the question
   without anybody being asked now — the same defect `ALLOW_FORCE_UNSHARED` is cleared to prevent.
2. It names the **ref**, not `yes`. An attestation about one branch cannot carry to another.
3. `unknown` still refuses whatever was attested, for the § 4.11 reason.

The test is a nine-row matrix over reading × attestation, plus a control that exports
`UNSHARED_ATTESTED` from outside and asserts the push is still refused.

### 4.14 Identity is not ownership

§ 4.8 taught `/codex-setup` Phase 3 to refuse to clobber a foreign `pre-push`. Round 60 found the
**state machine** had not learned it. `doctor` decided a hook was `active` from three predicates:
the resolved path is the written path, and it is executable. After Phase 3 refuses, both are true of
the **foreign** hook — `$resolved` and `$written_path` are then the same file. So the skill reported
the gate as installed on a project where it had, correctly, installed nothing.

Ownership is the only one of the three that can tell them apart: the `# <script> - ` marker in the
first 20 lines. The Active predicate now requires all three, and a fourth state was added rather
than folded into an existing one — **`pending` (terminal)**: the resolved file is the written path,
it executes, and it is not sd0x-owned. It is terminal because the remedy is not to try again;
re-copying is exactly what Phase 3 refused to do. The operator merges the two hooks or chooses a
different mode.

### 4.15 A hit is a label, not a verdict

`/smart-rebase`'s analyzer warns when a remote carries a negative fetch refspec, because a negative
refspec can empty a transfer and make the refresh silently useless. The C5 gate predicted the
failure from the presence of a `^`-prefixed refspec, and that prediction is wrong in the ordinary
case.

Measured against a real bare remote, 2026-08-22: a negative refspec empties the transfer only when
it cancels **every** positive mapping. With `^refs/heads/*` beside `+refs/heads/*:refs/remotes/…`,
no `refs/remotes/cancelled/*` appears. With `^refs/heads/wip/*`, `refs/remotes/cancelled/main`
appears exactly as it should — the rest of the namespace is still reachable.

So the warning stays and the verdict goes: a `^` refspec now prints "if the analyzer aborts on an
empty transfer, this is why" and lets the analyzer answer the question it is the only thing that can
answer. The prose says it in one line — **a hit is a label, not a verdict** — and the gate's exit
status now answers exactly one question, which is whether the config could be read.

### 4.16 Closing the config channel while the environment kept a door open

Round 61. § 4.3 closed `url.<host>.insteadOf` by stripping `GIT_CONFIG_COUNT`/`_PARAMETERS`/
`_GLOBAL`, on the reasoning that a variable able to send the approved refspec to another server has
no business being inherited. The same reasoning was not applied one row down. Both documents said,
in almost the same words, that the transport set "says how to authenticate, not what is pushed" —
and `test/skills/epic-merge.test.js` pinned that reading in place with an `assert.doesNotMatch`,
so the belief was not merely written down, it was enforced.

It is false. Measured 2026-08-22 on git 2.55.0, against `ssh://approved.example/team/a.git`:

| Exported | git ran it as | argv it received |
|----------|---------------|------------------|
| `GIT_SSH_COMMAND` | the connection | `[approved.example] [git-receive-pack '/team/a.git']` |
| `GIT_SSH` | the connection | the same |
| `GIT_PROXY_COMMAND` (`git://`) | the connection | `[approved.example] [9418]` |
| `GIT_ASKPASS` | — | never invoked |

The host and the remote command are **arguments**, not constraints. A wrapper is free to ignore both
and speak to a different repository; its stdout *is* the protocol stream, which is how the probe
above was detected in the first place (`fatal: protocol error: bad line length character: WRAP`).
`--receive-pack=git-receive-pack` cannot help — that string is one of the arguments being ignored.

The failure scenario is the one the whole feature exists to prevent, and every control reports
success while it happens: Phase 0 reads `origin`, prints and digests **A**, the operator approves
**A**, `pre-push-gate.sh` verifies A's digest and prompts about A's refs — and the `--force-with-lease`
lands on **B**, because the lease is negotiated over the connection the wrapper opened. `/epic-merge`
is worse again: it pushes in a loop, so one inherited value redirects every iteration.

The three names are now in the canonical strip list — all 26 sites in `/push-ci` and all 48 in
`/epic-merge`, not the push lines alone. That is deliberate: the `ls-remote` that measures the
topology (§ 4.9, § 4.11) and the push that acts on the measurement must reach the **same**
destination, and two prefixes are two things to drift.

`GIT_ASKPASS` stays unstripped, and the difference is measurable rather than stylistic: it is handed
a prompt and returns a credential on stdout, so it cannot choose a destination. The test asserts its
**absence** from the list for the same reason it asserts the three names' presence — a strip list
that grew until it swallowed the credential helper would pass every positive assertion and break
real pushes.

**What this does not close, stated so nobody reads it as more.** The strip closes the
**environment** channel only. `core.sshCommand` and `url.*.insteadOf` in the repository's own config
still apply, deliberately: that config is the operator's, it is the same trust level as the working
tree they are about to publish, and it is also what keeps their key selection working after this
change (`~/.gitconfig`, `~/.ssh/config`). What is lost is the ad-hoc `export GIT_SSH_COMMAND=…` for
one shell.

Round 61 wrote that this loss is **loud** — the push fails to authenticate rather than succeeding
against the wrong repository — and called that direction the whole point. Round 62 corrected it: the
claim holds only when the fallback fails. `GIT_SSH_COMMAND='ssh -p 2222'` does not merely say *how*
to connect, it carries part of *where*; strip it and the push goes to port 22 on the same host, which
on a host that also serves that path there, with the same key, succeeds. The clearing is therefore a
destination change of its own, in the opposite direction from the one it was defending against, and
neither direction is one this phase may take silently — § 4.18 is what follows from that.

One further residue, named rather than quietly left: `/epic-merge`'s `gh pr view` / `gh pr edit` /
`gh pr merge` calls carry no environment discipline at all. That is a different surface and a
different question — `gh` speaks to the API rather than opening a git transport, and which PR it
acts on is bound in Phase 0 from `gh pr view` itself — so it is not covered by this strip and is not
claimed to be. It is recorded here so the next reader does not infer from the thoroughness of the
git side that the `gh` side was considered and found safe.

### 4.17 The word that decides, one layer further down

§ 4.7 established that a command word can be replaced by an imported function. Round 61 measured how
far that reaches, and the answer is further than the fences had assumed. Under a shadow declaring
`return 7`:

| Form | Under `BASH_FUNC_<name>%%` | Why |
|------|---------------------------|-----|
| `true`, `false` | returns 7 | regular builtins; a function outranks them |
| `exit` | returns 7 — `( exit 1 )` exited **0** | special builtin, still shadowable in bash's default mode |
| `[` | returns the shadow's status | a builtin like any other |
| `[[` | unaffected | a **keyword**, resolved by the parser before any name lookup |

Two places were relying on a replaceable word. `skills/smart-rebase/SKILL.md`'s Step 1 gate ended in
`true` / `false` terminators, so its documented contract — "the exit status answers exactly one
question: could the configuration be read?" — was forgeable in both directions; it now ends in a
trailing `[[ "$rc" -eq 0 || "$rc" -eq 1 ]]` that states the verdict rather than delegating it, and
its messages moved to stderr so a wrapper reads the status and a human reads the text. And § 4.13 of
this document illustrated the attestation check with a bare `[ … ] || { … }` while the shipped fence
used `[[ … ]]` — a document arguing that the deciding word can be replaced, demonstrating the
replaceable word. A maintainer syncing the skill to the doc would have reintroduced the bypass.

The residue is honest: `echo` is a builtin too, so a shadowed one silences the message. What the
keyword buys is the **verdict form**: no imported function can invert the last line, so a fence that
refuses cannot be made to report success by replacing a word. The verdict's **inputs** are a
separate question and they are *not* forgery-proof — they come from bare commands, so a shadowed
`git` hands an unshadowable verdict a false premise. `skills/smart-rebase/SKILL.md` § Step 5 states
the same narrowing beside the gate it applies to; the fix for the input half is not a better
terminator but `bash -p`, which discards function imports outright.

### 4.18 A fourth transport name, and why clearing is not the answer on its own

Round 62. Two findings on the same surface § 4.16 had just closed, and they point in opposite
directions — which is the useful part: one says the list was too short, the other says the list is
the wrong instrument to finish with.

**The fourth name.** `GIT_SSH_VARIANT` was missing, and the reason it was missing is legible in
§ 4.16's own argument: every name there earned its place by being *an executable git runs as the
connection*. `GIT_SSH_VARIANT` runs nothing. It selects which command-line dialect git speaks to
whatever transport does run — and dialects disagree about what a port is. Measured 2026-08-22, git
2.55.0 with OpenSSH 10.3p1, against `ssh://example.invalid:2222/team/a.git`:

| `GIT_SSH_VARIANT` | argv git built |
|-------------------|----------------|
| unset (auto) | `ssh -o SendEnv=GIT_PROTOCOL -p 2222 example.invalid …` |
| `plink` | `ssh -P 2222 example.invalid …` |

OpenSSH's `-P` is not a port. Its usage line reads `[-P tag]`, so `2222` is consumed as a tag and
the connection falls back to 22 with no error, no warning and no failed push. Where port 2222 is the
approved repository and port 22 on the same host is another one, that is § 4.16's failure scenario
reached without ever naming an executable. The name is now in the canonical prefix at all 24
`/push-ci` sites and all 48 `/epic-merge` sites, and the test asserts a **real argv and a real
port** in both directions rather than list membership — a fake `ssh` on `PATH` records what git
handed it, and the assertion is that `-p 2222` survives the prefix while `-P 2222` does not.

An empty value is not an opt-out here either: an empty `GIT_SSH_VARIANT` reads as auto-detect, while
an empty `GIT_SSH_COMMAND` is *run* — measured, git executes the empty string
(`run_command: GIT_PROTOCOL=version=2 '' -G …`). Set-ness, not emptiness, is the property that
matters, which is why the refusal below tests `${VAR+set}` — four literal tests, one per name.
It read `${!_n+set}` in a loop until round 66: same property, but indirect expansion is bash-only
and zsh 5.9 rejects it outright, so on the platform's default shell the loop aborted at its first
iteration and the refusal never ran (§ 4.25).

**Why the strip cannot be the whole answer.** Clearing a transport variable is not a neutral
restoration of the default — it is a destination change made by this skill, on the operator's
environment, without saying so. The asymmetry § 4.16 relied on ("what is lost is lost loudly") holds
only where the fallback fails to connect. It does not hold on the case that matters: one host, two
ports, two repositories, one key. There the ad-hoc `-p 2222` is dropped, the push succeeds against
the wrong repository, and every control reports success — the same ending as the attack the strip was
added to prevent, arrived at from the other side.

So Phase 0 now **refuses** rather than adjusting. Four names, checked for set-ness before anything
reads a ref:

- `/push-ci` — step 0b, after the flags are bound and before `BRANCH` is read;
- `/epic-merge` — before Step 0's fetch, and deliberately *before* rather than after: that fetch is
  itself a transport operation **that writes refs**, so a redirected one does not merely misreport
  the chain, it fills `refs/remotes/origin/*` from another repository and every count, backup tag,
  rebase destination and lease below is computed from those.

The `-u` list stays as defence in depth for any caller that reaches a later phase without passing
through the refusal. The refusal prints **names and never values** (Anchor Register #2 — a transport
command line routinely carries a key path), and the test asserts both halves: that a value containing
a key path does not appear in the output, and that the same run does name the variable, so the first
assertion is about the value rather than about a block that printed nothing.

**Named residues, not closed.** `GIT_SSL_NO_VERIFY` and the `ALL_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`
trio plausibly belong to this class and are **not** in either list, because their effect on this
repository's push was not measured and § 4.16's whole lesson is that reasoning about this surface
without measuring it produces confident, enforced, wrong answers. They are recorded here so their
absence reads as unfinished work rather than as a considered exclusion.

### 4.19 A gate that classifies exit codes must survive `set -e`

The smart-rebase Step 1 gate (§ 4.15) exists to separate three outcomes of one `git config` read:
0 means the key is set, 1 means it is not — a real answer, not a failure — and anything else means
the configuration could not be read at all. Round 62 found the shape could not deliver that to a
caller running under `set -e`:

```bash
refspecs=$(git config --get-all "remote.${remote}.fetch"); rc=$?   # before
if refspecs=$(git config --get-all "remote.${remote}.fetch"); then rc=0; else rc=$?; fi   # after
```

An assignment whose command substitution fails carries that status itself, and `set -e` acts on it
**before** the next line runs — so `rc` is never read, the three-way classification never happens,
and the caller's shell exits 1 on the case the gate calls *proceed*, with nothing on stderr to say
why. A command in an `if` condition is exempt from `set -e` by the shell's own rule, which is the
entire reason for the shape. The regression test runs both forms under `set -e` against a real git
and asserts a marker line after the fence: reached with the fix, absent without it.

### 4.20 The push pinned who receives it; the read that decided what to push pinned nothing

Round 63. Every push in both skills has carried `--receive-pack=git-receive-pack` for many rounds:
the option's *safe* form is passed rather than withheld, because a command-line value overrides
`remote.<name>.receivepack` and withholding it leaves the configured one deciding. The reads that
produce the facts those pushes act on — `git ls-remote` in `/push-ci`'s preflight and final
re-check, `git fetch` in `/epic-merge`'s refresh and resume — carried no such pin, and git has the
symmetric key.

Measured 2026-08-22, git 2.55.0, in a scratch repository:

```bash
git -c remote.x.url=/definitely/not/here \
    -c "remote.x.uploadpack=git-upload-pack '$PWD/.git' #" ls-remote x HEAD
# → a71f5794…  HEAD          (rc 0 — refs served by a repository the URL does not name)
git -c remote.x.url=/definitely/not/here \
    -c "remote.x.uploadpack=git-upload-pack '$PWD/.git' #" \
    ls-remote --upload-pack=git-upload-pack x HEAD
# → fatal: … make sure … the repository exists   (rc 128)
```

The key is scoped to a remote **name**, so the URL-form reads (`ls-remote -- "$PUSH_URL"`) are not
reachable this way. The pin goes on every read regardless, and the reason is the one that kept the
`env -u` prefix identical across 74 sites: a rule with exceptions is a rule someone drops at the
site where it mattered. `git-upload-pack` is also the default, so the pin costs nothing where it
is not needed.

What it buys is a property, not a patched hole: **a measurement and the push that acts on it must
reach the same repository.** A preflight that reads its ancestry from elsewhere hands a correctly
implemented gate a premise about a repository nobody is pushing to. The test is written over *every*
`fetch`/`ls-remote` line in each document rather than the four that needed it, because the read
added later is exactly the one nobody thinks to pin.

### 4.21 A loop's exit status is its last iteration's

Round 63, and the same defect § 4.12 fixed for Steps 2–4, in the two places that were still bare.

```bash
for pr in 101 102; do
  head_branch=$(gh pr view "$pr" --json headRefName -q .headRefName)
  git tag -f "backup/pr-${pr}" "refs/remotes/origin/${head_branch}"
done                      # ← status: whatever PR 102 did. PR 101's failure is gone.
```

Phase 1 wrote the backup tags and the expected manifests this way. A `gh pr view` that failed for
the first PR, or a `git tag` that could not write, was erased by the second PR succeeding — and
Phase 2 then force-pushes a rewritten branch whose promised rollback point does not exist. The
sequential form fails identically without a loop: iteration 1 ran `gh pr merge <first-PR> --squash`
followed by a `git fetch`, so a refused merge was answered for by the fetch, and iteration 2
rebased onto an epic branch that never received PR 1.

The fix is the shape round 63 settled on one section earlier: a refusal **records into an
assignment**, and the consequential step is reached only through `[[ ]]`.

```bash
PHASE1_OK=1
for pr in <PR-numbers>; do
  head_branch=$(gh pr view …) || { echo "⛔ …" >&2; PHASE1_OK=; break; }
  …
done
[[ -n "$PHASE1_OK" ]]     # ← the fence's verdict
```

Three properties, each load-bearing:

| Property | Why |
|----------|-----|
| The flag is set **once**, before the loop, and only ever cleared | So a later iteration cannot restore it, and `break` is an optimisation rather than the guard — `break` is a builtin an imported function outranks (§ 4.17) |
| The verdict is the fence's **last line**, a keyword | The parser resolves `[[` before name lookup; no imported function can invert it |
| The manifest loop is also *gated* on the flag, not merely guarded inside it | With `MANIFEST_DIR` unresolved the redirect expands to `/expected-pr-<N>.manifest` and the loop writes at the filesystem root |

Pinned by execution, not by reading: the tests extract each fence, substitute the placeholders, run
it against a recorded fake `git`/`gh`, and assert the exit status. Each ships the mutant that
strips the guards — which must exit 0 on the same failure, since that is the behaviour being
pinned — and asserts the strip actually applied.

### 4.22 What "not normalized" rests on, and the sentence that got it wrong

`scripts/pre-push-gate.sh` closes two channels positively (`GIT_GRAFT_FILE=/dev/null`,
`GIT_NO_REPLACE_OBJECTS=1`, § 4.3) and leaves four other names alone. The two groups are left for
different reasons, and round 64 found the second reason stated falsely.

`GIT_SHALLOW_FILE` and `GIT_ALTERNATE_OBJECT_DIRECTORIES` are both left alone, but **not for the
same reason** — round 66 found this paragraph asserting one reason for both, and the second half of
it measurably backwards. Shallowing can only make ancestry **unprovable**, the fail-closed side of
the `!` on `merge-base --is-ancestor`: a graph the gate cannot read lands in the same branch as a
graph that says "not an ancestor". Alternates do the opposite — they make ancestry *more* provable
(the 128 → 0 measurement in § 4.3) — and are still nothing to close, because objects are
hash-addressed: an alternate store can hand the gate a commit it was missing, never a different
commit under the same name. Either way no name here turns a rewrite into a fast-forward.

The transport variables — `GIT_SSH_COMMAND`, `GIT_SSH`, `GIT_PROXY_COMMAND`, `GIT_SSH_VARIANT` —
are a different case, and r5's original wording for it ("they say how to authenticate, not what is
pushed") was wrong: round 63 measured each of the first three naming a program run **in place of**
the connection, and `remote.<name>.uploadpack` serving refs from a repository the URL does not
name. They decide the destination outright.

Round 63's replacement wording was also wrong, in a smaller way that is worth recording because it
is the kind of sentence that reads as an argument while being a restatement: *"they cannot reach any
answer computed here … every comparison below is local ancestry."* The second clause is false. The
destination binding (§ `SD0X_PUSH_DEST_DIGEST`) digests `$2`, reads
`remote.<name>.receivepack`, and refuses on either — comparisons about the destination, in the same
script, added rounds earlier.

What actually holds is a **timing** claim, and it covers both kinds of comparison:

| Comparison | Input | Reachable by a transport variable? |
|---|---|---|
| `merge-base --is-ancestor` | the local object store | No — no transport name touches it |
| destination digest | `$2`, the URL git resolved before invoking the hook | No — resolved before line 1 of this script |
| `remote.<name>.receivepack` | git's own config | **Yes** — and not fixed either; see below |

The first two rows are fixed before line 1: the hook runs **inside a push git has already routed**,
so the object store and `$2` are what git chose. **The third is neither fixed nor out of a transport
variable's reach**, and round 66 measured the second half rather than inferring it. Built on
2026-08-22: a bare remote, a work repo with `remote.origin.url=ssh://fakehost/irrelevant`, a
`pre-push` hook logging the value of `remote.origin.receivepack`, and a fake `GIT_SSH_COMMAND` that
logs, runs `git config --file …/.git/config --unset remote.origin.receivepack`, then execs
`git-receive-pack` against the bare remote. The order file read `SSH_RAN`, `SSH_RAN`, `HOOK`,
`HOOK sees receivepack=[]` — the transport program ran **twice before the hook**, and the hook read
the config it had already emptied. The push reported `* [new branch] main -> main`.

So the third row's answer is **Yes**, and the earlier "No" was the last surviving piece of r5's
original framing: transport variables were treated as a layer that could only speak *after* the
hook's reads, when git runs them *before*. That read is **best-effort by construction**; what closes
the case for the two authorized skills is their push line spelling `--receive-pack=git-receive-pack`,
not this read.

**The conclusion survives the correction, on a different footing.** Normalizing the transport names
*inside this script* still changes no verdict — not because they cannot reach this read, but because
by the time line 1 of the hook runs they already have, and unsetting a variable after the program it
named has finished editing the config unsets nothing that matters. Reachability is the wrong axis
for a hook; **ordering** is the axis, and on that axis the hook has no move. The destination question
therefore belongs to the caller, which is why `/push-ci` Phase 0 step 0b **refuses** a set transport
variable rather than clearing one (§ 4.18) — a refusal happens before the push, which is the only
place it can help.

### 4.23 The prefix closes one channel; the other one was open

The absolute `/usr/bin/env` prefix every command in `/push-ci` and `/epic-merge` carries was
justified — round 39, and correctly — by a measured property of bash: it refuses to **import** a
function whose name contains `/` from the environment, so `BASH_FUNC_/usr/bin/env%%` cannot forge
the sanitizer the way `BASH_FUNC_env%%` could.

Round 64 measured the other half of that sentence and found it missing. Refusing to *import* such a
name says nothing about **defining** one, and a non-interactive bash **sources `$BASH_ENV`** before
line 1 of the fence — zsh does the same with `$ENV` under sh emulation.

| Command | Result |
|---|---|
| `/bin/bash -c 'source fn.sh; /usr/bin/env true'` | `INTERCEPTED: true`, rc=0 |
| `BASH_ENV=fn.sh /bin/bash -c '/usr/bin/env -u BASH_ENV git --version'` | `INTERCEPTED: -u BASH_ENV git --version` |
| `/bin/zsh -c 'function /usr/bin/env { … }; /usr/bin/env true'` | `ZSH INTERCEPTED` |
| zsh with `BASH_ENV` set | rc=0, no interception — zsh does not source it |
| `bash -p` with either channel | no interception — both closed |

(`fn.sh` holds `function /usr/bin/env { echo "INTERCEPTED: $*"; }`. bash 3.2.57, zsh 5.9,
2026-08-22.)

So a startup file the operator did not write can make every reading the phase prints — the branch,
the destination digest, the gate probe — say whatever it likes, and the approval is then collected
against a fiction. **Phase 0 step 0a** closes the **detectable** part, which is not the same as the
reachable one: it refuses on the **set-ness** of `BASH_ENV`/`ENV`, before any ref is read, printing
the names and never the values (Register #2). A parent that sources its file and then unsets the
variable is no less reachable — it is simply no longer visible to a check that reads variables, and
the closing paragraph of this section says who owns what is left.

**The terminator is an expansion failure, not `exit`**, and that is the part worth recording:

| Form | Under `eval "function exit { return 0; }"` |
|---|---|
| `echo "refusing"; exit 1` | prints `REACHED_AFTER_EXIT`, rc=0 — the guard is bypassed |
| `: "${NOPE:?refusing here}"` | message on stderr, nothing after it runs, rc=127 |
| the same with `:` itself shadowed | still terminates |

`exit` is a builtin a function outranks. A check whose entire subject is *this shell may be under
someone else's control* must not be terminated by a word that shell can redefine. The negative
control in `test/skills/push-ci.test.js` runs both rows, so the sentence is earned rather than
asserted.

**One thing step 0a does not close**, stated because the round's other finding was a claim that
over-reached: a startup file that defines the function and then `unset`s the variable leaves
nothing to detect from inside the fence. That residue has no owner downstream — the comment that
used to hand it to `pre-push-gate.sh` ("it re-execs under `bash -p`, so L1 is where the
authorization lands") was true only where L1 is installed, and the hook is opt-in.

**And a defect the executing tests caught in the fix itself.** The first refusal word was
`the interpreter's startup file is inherited — refusing`. Inside `${var:?word}` bash reads an
apostrophe as an opening quote **even within double quotes**, and it is a *parse* error, so it takes
the whole fence down — the ordinary, non-refusing path included:

```
$ : "${NOPE:?the interpreter's startup file}"
bash: line 1: unexpected EOF while looking for matching `''
```

Six red tests, one of them the fan-out case that has nothing to do with startup files. A
`bash -n` parse case now states the class directly, so the next diagnostic string fails with the
reason instead of as a scatter.

### 4.24 An approval collected for a push that could never run

`/push-ci --force-with-lease` against a remote whose `origin` resolves to more than one push URL
was **already refused** — in the Phase 2 topology re-check, which holds one `FINAL_TIP` and reads a
fan-out as `unknown`. The refusal was correct. Its **position** was the defect: by the time it
fired, the plan had been shown, the unshared question had been put to the operator by name, and an
approval had been collected — for a push that was never going to happen.

That is worse than no approval. It teaches the operator that the question is a formality, on the one
surface where the answer is the whole credential when the hook is not installed.

The fix is a preflight refusal (step 7c), before the plan exists. It removes no capability: every
one of these pushes was refused one shell later. Two boundaries are pinned in both directions —

| Case | Behaviour |
|---|---|
| `--force-with-lease` × two push URLs | refused in Phase 0; the report line is never printed, so no plan is built |
| plain push × the same two URLs | runs clean — a fan-out is supported, and git invokes the pre-push hook once per push URL |
| `--force-with-lease` × one push URL | runs clean; `FORCE_WITH_LEASE=[true]` reaches the report |

— because the first case alone is satisfied by a skill that refuses every fan-out, and the second
alone by one that never checks.

The alternative Codex raised (classify each destination independently, one lease and one attestation
per URL) is a **widening** of an Anchor Register #4 surface, not a bug fix. It is recorded here and
put to the user, not adopted while closing a finding.

### 4.25 A guard whose own sentinel could be preset, and a shell it never ran in

Round 64's step 0a was written as a small script — a loop over two names, an indirect expansion,
five `echo`s and a `${SENTINEL:?}` terminator — for a check whose entire subject is *a shell someone
else prepared*. Round 65 measured two ways that shape failed, and they are the same mistake twice:
the guard trusted the environment it was written to distrust.

| Defect | Measured 2026-08-22 | Consequence |
|---|---|---|
| The sentinel was expanded without being reset | `SD0X_X=1 bash -c ': "${SD0X_X:?refusing}"; echo FELL_THROUGH'` → prints `FELL_THROUGH`, rc=0 | One exported variable disarmed the whole check. No shadowing, no startup file — a plain `export` |
| `${!_n+set}` is bash-only | zsh 5.9: `bad substitution`, rc=1, including under `--emulate sh` | On the platform's default shell the block aborted at the **first** loop iteration whether or not anything was set, so the `ENV` refusal it documents never ran at all |

`:?` fires on **null or unset**, which is why the fix is one line and unconditional: assign empty,
*then* expand. An assignment is syntax rather than a command word, so no imported function outranks
it — verified with `SD0X_PUSH_CI_REFUSED=1` preset **and** with `echo`, `unset`, `:` and `exit` all
redefined by a sourced `BASH_ENV` file: still rc=1, message intact, because the message lives in the
`:?` word rather than in an `echo`. `scripts/pre-push-gate.sh` already had this right
(`SD0X_PRIV_GUARD=''` before the expansion); the skills did not copy it, and copying the *idea*
without the reset is what produced a guard that read correctly and held nothing.

The loop is gone with the indirect expansion: two `[[ ]]` tests name the two variables literally.
The block now contains **no command word at all**, which is the property
`test/skills/push-ci.test.js` pins directly — every executable line must match one of four shapes,
and the `:?` word is skipped as the message text it is.

**A test that names a shell must run that shell.** The round-64 case called
`step 0a when ENV is set → refuses on zsh's startup variable too` and then executed `bash`. It
therefore proved that bash can read a variable named `ENV` — while the shipped block was, in zsh,
a syntax error. The harness now takes the shell as a parameter and the zsh cases run zsh, skipping
only where no zsh exists. The same round's step 7c terminator was a bare `exit 1`, bypassed by an
imported `BASH_FUNC_exit%%` that returns (measured: the refusal printed and execution continued into
the report and the approval); it now terminates through the same construction, with the old form
kept as the negative control.

**Round 66 found the same construction one block later, in the block the same round-65 fix had just
walked past.** Step 0b's transport refusal still looped over `${!_n+set}`. Measured 2026-08-22 under
zsh 5.9: `bad substitution`, rc 1, at the **first** iteration — whether or not any transport
variable was set — so on the platform's default shell that refusal never ran, and neither did the
rest of Phase 0. Two properties of the miss are worth keeping. The **cross-skill parity test did not
help**, because both skills carried the identical defective block: parity asks whether the two
copies agree, and they agreed. And the round-65 fix was scoped to the block that the finding named
rather than to the construction it was about — a fix scoped to a location leaves every other
instance of the same construction standing, which is the general form of this miss and not a fact
about these two blocks. Round 66's tests close both: the guard is now executed under zsh in both
skills, and each has a negative control that puts the loop back and shows zsh aborting on a clean
environment.


### 4.26 A PASS verdict is about a commit and a base, not about a PR number

Round 64 made the CI wait a fence boundary, so `/epic-merge` Step 8 can no longer run before a
`PASS` verdict exists. What the fence still could not say is that the verdict is about **the thing
being merged**. `/watch-ci` waits minutes; a PR is mutable throughout and afterwards. A collaborator
pushing to the head branch, or anyone retargeting the PR, left `gh pr merge "<N>" --squash` merging
a commit nothing tested — or merging it into a base nobody approved — on a fence that reads as
though it had waited for exactly this.

Two bindings, because a PR can move two ways and they need different instruments:

| Moved | Instrument | Why this one |
|---|---|---|
| head commit | `gh pr merge --match-head-commit "$CI_PASSED_SHA"` | Checked **by GitHub at merge time**. A local comparison would read the head, then merge, and lose the race in between |
| base branch | re-read with `gh pr view --json baseRefName` immediately before, and refuse on mismatch | gh has no `--match-base`. The residual window is real, and the fence says so rather than letting the code imply otherwise |

`CI_PASSED_SHA` is written into the fence **literally**, by the model, from the `PR_HEAD_SHA` the
previous fence printed — the same carry `/push-ci` Phase 2 uses for `PLAN_PUSH_URLS`, and for the
same reason: fences do not share a shell, so a value that crossed one on its own would be a value
nobody carried. Re-deriving it here would resolve the head **as it stands now**, which is precisely
the value the check exists to distrust. Empty refuses.

Seven cases pin it in `test/skills/epic-merge.test.js`, with `gh` stubbed so what is measured is the
fence's control flow: the ordinary path merges *and carries the flag*; an empty SHA, a retargeted
base and an unreadable base each refuse **without calling merge**; a merge GitHub rejects blocks the
iteration rather than only the merge. Two of the seven are negative controls — delete the flag, or
disable the binding check — because a guard nobody can delete is a guard nobody has tested.

### 4.27 A refresh whose failure nothing reads

Three fences ran `git fetch` to move `refs/remotes/origin/${epic}` and then reported the status of
the **merge**. The fetch's own status was never read. A merge that succeeded followed by a fetch that
did not therefore exited 0, and the fence read as "iteration complete".

What that costs is not a stale ref. The next iteration rebases onto
`refs/remotes/origin/${epic}` and **force-pushes** the result, so a fetch that silently failed
produces a force-push of history that does not contain the PR just merged — the exact outcome the
whole iteration gate exists to prevent, reached without any step reporting an error.

| Site | Was | Now |
|---|---|---|
| Iteration 1 | `[[ -n "$ITER1_OK" ]] && <fetch>` — the fetch is the last command, its status discarded by the conjunction that precedes it | `ITER1_REFRESHED` set only on a successful fetch; the fence's exit status is `[[ -n "$ITER1_OK" ]] && [[ -n "$ITER1_REFRESHED" ]]` |
| Step 9 | `[[ -z "$MERGE_BLOCKED" ]] && <fetch>`, then `[[ -z "$MERGE_BLOCKED" ]]` — the flag cannot have changed, so the final test re-reports the merge | the fetch's failure sets `MERGE_BLOCKED=1`; from Step 9 on the flag means "this iteration did not complete" |
| § Recovery resume | a bare fetch, then a bare rebase using the ref it was meant to move, then `gh pr edit` retargeting on the strength of both | `RESUME_OK` gates the rebase, and the rebase gates the retarget; the force-push instruction says explicitly that it runs only while `RESUME_OK` is still set |

The two executable fences are run as shell in `test/skills/epic-merge.test.js` with `gh` and `git`
stubbed to fail independently, so (merge, fetch) is driven as four cases rather than one. Each has a
negative control that restores the old exit-status line and shows the failed fetch exiting 0 again —
without it, the tests pass on any fence that happens to exit non-zero and say nothing about which
line does the work.

**The messages are deliberately not shared.** A failed merge and a failed refresh need different
repairs: the first must not be repeated blindly, the second must be re-run by hand and confirmed
before resuming. A single "iteration failed" message would send the operator to the wrong one.

### 4.28 Two test instruments that were measuring something else

Both were green, both looked like the control they were named after, and neither could see the
regression it existed to catch.

**An unresolvable OID is not a divergence.** The SHA-256 control pushed `'b3a1'.repeat(16)` against
`'c7d2'.repeat(16)` and asserted the gate blocked. Those 64 hex characters name no object, so
`merge-base --is-ancestor` exits **128** (`fatal: Not a valid commit name`), never 1 — the gate
blocked on the fail-closed path, not on an ancestry verdict. The test would therefore have stayed
green on a gate that could not read ancestry at SHA-256 width at all, which is precisely the
regression the null-OID widening could introduce. It is renamed to what it tests, and the case it
was standing in for now runs against a real `git init --object-format=sha256` repository: ancestry is
asserted to answer **1** before the gate is run, so a fixture that stopped resolving fails loudly
instead of quietly returning to the old blind spot.

**A ref creation is not a fast-forward.** The "ordinary fast-forward push is untouched by the
attestation" control carried the null remote OID — a ref *creation*, a case two tests above it
already cover. So the only negative control on the attestation asserted that creations pass while
claiming to assert that fast-forwards do, and a gate that demanded an attestation on every genuine
fast-forward would have passed it. It now uses the two-commit fixture's `ffRef`, which is a real
fast-forward of an existing ref.

The shared shape: **a control is only worth what its input actually is.** Both of these were written
from the ref line's *shape* — 40 or 64 hex characters, a null on one side — rather than from what
git does with it. Checking the intermediate fact (what does `merge-base` return here? is this ref
being created or advanced?) is what separates the two.

### 4.29 A refusal that printed and exited zero

Phase 2's `PUSH_BLOCKED` arm is the fence's answer to a shadowed `exit`: every guard above records
its refusal in the variable, and the push sits behind a `[[ ]]` that tests it, so an imported
`BASH_FUNC_exit%%` that returns cannot let the push run. That half worked. The arm itself ended on
`echo`, which **succeeds** — so the fence exited 0 for a push it had just refused, Phase 2 read as
complete, and the caller went on to dispatch `/watch-ci` for a push that never happened.

The push was never at risk; the **report** of it was, and the report is what the next step consumes.
The terminator is the same assign-then-expand construction step 0a uses: `SD0X_PUSH_CI_REFUSED=` is
a syntax assignment no imported function can shadow, and `: "${…:?…}"` on a null value exits
non-zero. Another `exit` here would have been the same defect twice, in the one arm that exists
*because* `exit` was answered.

Pinned by the pair in `test/skills/push-ci.test.js`: the refusal under an imported `exit` must exit
non-zero, and the control — the terminator deleted, everything else identical — must exit 0. Without
the control the first assertion is satisfied by any unrelated non-zero status the fence happens to
carry.

### 4.30 A fence that classified `refs/heads/`

Phase 1's topology fence names `"refs/heads/${BRANCH}"` in every lookup it makes, and nothing in it
bound `BRANCH`. Phase 0 binds one — in a different shell, which is precisely what § Names in commands
says every fence is. Unset, the refspec is `refs/heads/`: the exact-ref lookup returns no line,
`REMOTE_TIP` is empty, and the classifier reads `creation`.

That reading is what decides whether the unshared question is asked at all, so a push that rewrites
`feat/x` skipped it. The failure is silent in the one direction that matters, because `creation` is
also the honest answer for a genuinely new branch — the output is indistinguishable from a correct
run, which is why no assertion about the classifier's *behaviour* could have caught it.

Two symmetrical cases in `/epic-merge`'s iteration gate, and the same cause: `head` and `epic` both
reach a command line there, both bound only in Step 0. Unset, the per-step classifier answers about
`refs/heads/` and the bundled one degrades to `unknown` because its local refs will not resolve —
either verdict is about an empty name rather than about the iteration the operator is approving.

All three now bind the name in the fence that uses it and refuse when they cannot: an empty
`rev-parse` answer, a `rev-parse` that failed, and a detached `HEAD` are three ways of not having a
branch, and none of them is a classification.

**What the harness was doing.** Both test harnesses supplied these bindings through the environment —
`BRANCH: 'feat/x'`, `head: 'feat/pr-3'`, `epic: 'epic/x'` — which is a test answering the question
the document left open. Every assertion about the classifier stayed green while the shipped fence
classified an empty ref. The harnesses now do what the operator does: substitute the `<quoted …>`
slots the document writes, and export nothing past a fence that does not bind it.

### 4.31 Two questions one fallback could not tell apart

`git rev-list --count origin/$BRANCH..HEAD 2>/dev/null || echo "new branch"` answers *how far ahead
is this branch* by discarding every way the question can fail. `rev-list` exits 128 on a corrupt or
unreadable object graph; the `||` catches that exactly as it catches "there is no remote-tracking
ref", prints the reassuring reading, and exits **0** — in a phase whose stated contract is to
hard-abort on infrastructure failure.

Existence and countability are separate questions, so they are asked separately: `rev-parse --verify
--quiet refs/remotes/origin/<b>` first, and only a ref that **exists** but cannot be counted is an
error. The refspec is fully qualified for the reason § Names in commands gives — `origin/<name>` is
DWIM and git resolves `refs/tags/` before `refs/remotes/`, so a tag named `origin/feat/x` would
answer this range in place of the branch.

The control that earns the fix restores the one-liner and shows it calling a fatal `rev-list` a new
branch. The first two cases (a missing ref, an ordinary count) pass under **both** forms; only the
third separates them, which is what makes it the assertion rather than a third example.

### 4.32 A selector that counted the wrong thing

The forgery test for the two classifier reports found them by `line.startsWith('/usr/bin/printf ')`
and asserted there were exactly two. Both halves were wrong in the same way — the selector was the
property under test. A report that regressed to the bare word would drop **out of the selection** and
the test would pass by absence; and an unrelated line elsewhere in the document acquiring an absolute
path would break a test about forgery. § 4.30's fix nearly did the second on the way past.

Classifier reports are now identified by the fields that make them classifier reports
(`REMOTE_TIP=[%s]` and `LOOKUP_FAILED=[%s]`), found whatever spelling of `printf` they carry, and
*then* asserted to use the absolute path. The count stays, scoped to those two: it is this test's
coverage claim — both fences are checked — and it no longer moves when something else in the document
changes.

The same round added a third absolute-path report, `PR_HEAD_SHA`, for a reason the two classifiers
share: Step 8 writes that value back literally and merges with `--match-head-commit`, so a forged SHA
sends the merge, and `/watch-ci` after it, at the wrong commit while the fence still exits 0.

### 4.33 「乾淨」與「看不到」是兩件事，而 `$( )` 只回報得出一件

`/epic-merge` 的 rollback 路徑在還原前先確認工作區乾淨：

```bash
if [[ -n "$(<prefix> git status --porcelain)" ]]; then ... exit 1; fi
```

命令替換只把 **stdout** 交出來，狀態碼隨手丟掉。`git status` 失敗時什麼都不印，替換結果是空字串，
`[[ -n "" ]]` 讀成**乾淨**。2026-08-22 在 repository 外實測：exit 128、零位元組輸出，bash 3.2 與
zsh 5.9 都直接落到下一行——而下一行是 `git switch -C`，這條路徑本身就是**復原**路徑，
在這裡把未提交的工作蓋掉是最難救回來的一種。

修法是把三種狀態拆開：看不到、看到且髒、看到且乾淨，只有第三種可以往下走。

```bash
WT_STATUS=$(<prefix> git status --porcelain) || {
  ... PUSH_BLOCKED=1; SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the working tree could not be read}"
}
if [[ -n "$WT_STATUS" ]]; then ... fi
```

同一個「輸出不等於狀態」的形狀，`/push-ci` Phase 0 有兩處（§ 4.36）。

### 4.34 拒絕的終止子，和一個沒有跟上的例外

`git fetch` 刷新 `origin` 的失敗分支寫的是 `exit 1`。這份文件自己的作業模型（§ Names in commands）
就說 `exit` 是 builtin，匯入的 `BASH_FUNC_exit%%` 蓋得過它；startup guard 只看 `BASH_ENV`／`ENV`，
看不到匯入的函式。實測：`exit() { return 0; }` 之下，這個分支把拒絕訊息印出來、group 回傳 0，
底下每一步都拿**過期的** remote-tracking ref 去算 chain table。

改成同檔案 `PHASE1_OK` / `ITER1_OK` / `PUSH_BLOCKED` 早已在用的 assign-then-expand。
值得記的是**為什麼會漏**：這個模式在此檔已經套用過四次，第五處沒跟上——
一致性不是靠寫在規則裡維持的，是靠**可執行的測試**維持的，所以本輪替它補了一對
（匯入 `exit` 下必須非零、把 `exit 1` 放回去必須繼續執行）。

### 4.35 「已經是外部程式」不是防護

`| wc -l` 旁邊的註解寫著「`wc` 已經是外部命令，所以整個值都走 `BASH_FUNC_*` 拿不到的字」。
這句話是錯的。shell 的查找順序是 **函式 → builtin → PATH**，函式排在最前面，
所以外部程式一樣會被同名匯入函式攔下來——PATH 根本沒被查。實測 `wc() { echo 999; }`
讓這條 pipeline 印出 `999` 並 exit 0，chain table 的 commit 數就此被偽造。

真正免疫的是**含斜線的字**：bash 拒絕匯入名字裡有 `/` 的函式，所以 `/usr/bin/wc` 無法被宣稱。
同一條理由套用到 `gh`（§ 4.36 的第三筆）。這一節記的是判斷失誤本身：
「external」被當成「unclaimable」的同義詞，而它們只在 PATH 真的被查的時候才重合。

### 4.36 三處「呼叫了但沒看結果」

同一個形狀，三個位置，後果各異：

| 位置 | 形狀 | 失敗時發生什麼 |
|------|------|---------------|
| `/epic-merge` cleanup | `rm -rf "$(<prefix> git rev-parse --git-path epic-merge)"` | `rev-parse` 失敗印空字串，`rm -rf ""` 在 bash 3.2 與 zsh 5.9 都回 0（實測），manifest 留在磁碟上，而這是 fence 最後一條命令——cleanup 回報成功，**下一輪把這一輪的 manifest 讀成自己的** |
| `/push-ci` Phase 0 step 4 | `<prefix> git status --short` | 失敗印零位元組。Phase 0 的契約是 infrastructure failure 就 hard-abort，這裡卻讓「看不到」長得和「乾淨」一模一樣，而 push plan 是給人核准的 |
| `/push-ci` Phase 0 step 6 | `HEAD_SHA=$(<prefix> git rev-parse HEAD)` | `HEAD_SHA` 變空。Phase 2 會重新推導並比對，所以這**不是**通往危險 push 的路；它是**為一份從來不成立的計畫收到的核准**——計畫裡指名的 commit 是空的 |

`gh` 的八個呼叫點是第四種：形狀不同（狀態碼有看），但命令字可被宣稱。實測匯入的 `gh()` 記下引數、
回 0，`MERGE_BLOCKED` 保持空、底下的 fetch 對著沒變的 epic branch 成功，整個 iteration 回報**已合併**。
既有測試把假 `gh` 放在 PATH 上——那證明的是狀態碼傳播，對函式優先順序**一句話都沒說**，
因為函式存在時 PATH 從來沒被查。八處改走 `/usr/bin/env -u BASH_ENV -u ENV gh`，
與此檔早已免疫的 `BASE_NOW` 那一處同形。

### 4.37 修好三個實例，不等於關掉那個 class

Round 68 修了六筆「呼叫了卻沒看結果」與「命令字可被宣稱」。Round 69 的 reviewer 又找出三筆——
**都是同一個 class 的兄弟實例**：Phase 2 的 `MANIFEST_DIR` 推導、range 讀取的拒絕分支、
cleanup 的 `rm`。這件事本身比那三筆更值得記。

所以本輪先不修那三筆，而是把 class 掃過一遍（`grep` 兩個 SKILL.md 的 fenced 區塊）。掃出來的比
reviewer 找到的多四筆，其中兩筆在 `/push-ci` Phase 0——reviewer 這一輪只讀了它指名的位置。
**修實例會讓 reviewer 下一輪再找到一個；修 class 才會讓下一輪找不到。**

掃法要對才有意義。第一次掃「所有 `exit`」掃出 17 筆，其中 14 筆不是缺陷：
`PUSH_BLOCKED=1; exit 1` 這種寫法**設了一個後面守衛會讀的旗標**，`exit` 被蓋掉也還是落在拒絕上。
真正的 class 是**「唯一終止手段是 `exit`、沒有旗標」的拒絕分支**——精確定義之後，
epic-merge 剩 1 筆、push-ci 剩 2 筆，全部修完後掃描歸零。

| 掃描條件 | 掃出 | 其中真缺陷 |
|---------|------|-----------|
| 所有 `exit` | 17 | 3 |
| 只終止於 `exit`、無旗標 | 3 | 3 |
| 命令替換賦值未檢查 | 7 | 2（其餘後面緊接空值比對，fail-closed）|
| fence 內可被宣稱的命令字 | 4 | 2 修、2 一致性強化 |

### 4.38 一個推導的位置，決定它的失敗代價

`MANIFEST_DIR` 在兩個 phase 各推導一次，因為它們是不同的 shell。Phase 1 那次早就檢查了
（失敗清掉 `PHASE1_OK`）；Phase 2 那次沒有。差別不在寫法，在**下一條命令是什麼**：

```
Phase 1:  MANIFEST_DIR → (寫 expected manifest)          失敗只是少一個檔
Phase 2:  MANIFEST_DIR → git switch -C → git rebase --onto → (Step 4 比對)
```

Phase 2 的空值要到 Step 4 才顯現，而那時 branch 已經被覆寫、rebase 已經跑完。
`"${MANIFEST_DIR}/actual-pr-<N>.manifest"` 展開成 `/actual-pr-<N>.manifest`——檔案系統根目錄，
和 § 4.36 記的 cleanup 同一個 class，只是晚了兩步，而那兩步不可逆。
所以檢查放在推導處，不放在使用處。

### 4.39 兩張表的「HEAD」欄，指的從來不是 `git show HEAD:`

`smart-commit-hardening/4-implementation.md` § 11 的度量表有一欄叫 `HEAD`，並在底下附了
`git show HEAD:… | grep -c …` 這組指令。Round 69 的 doc reviewer 把指令跑了一遍：輸出和表格對不上。

追下去發現的不是數字過期，是**標籤從一開始就錯**。整個 repo 沒有任何 commit 的
`skills/smart-commit/SKILL.md` 是 579 行 / 43,892 bytes。最近三個動過該檔的 commit 分別是
811 行（`fead97d`）、823 行（`187b0aa`）、471 行（`96786d1`）。
那一欄其實是**重構前的工作區狀態**，從未單獨 commit 過，所以任何指令都還原不出來。

**這裡有一個我自己踩的坑，值得一起記**：初稿寫的是「round 10 當時的 `HEAD` 是 `96786d1`」——
那是從 commit 列表**推論**出來的，不是查到的。該 round 在文件裡沒有日期，所以無從對應；
而該 feature 的變更至今未 commit，round 10 當時的 `HEAD` 反而更可能是 `fead97d`。
糾正一個「拿相對參照當基準」的缺陷時，順手寫下另一個沒有證據的時點斷言，
是同一種錯誤換一個方向發生。**能成立的是那個否定句**（沒有任何 commit 產生該數字），
肯定句得有證據才寫得下去。

這件事有兩種修法，只有一種誠實。把數字改成今天 `git show HEAD:` 的輸出，表格會「對」，
但那樣比較的就不是重構前後了，整節的論證會消失。所以改的是**欄名**：
`round-10 baseline`，並寫明它不可從任何 commit 還原——**當時 `HEAD` 指向哪一個 commit 同樣無從重建**，
文件裡明說不重建，而不是補上一個看起來合理的答案。
還原不出來的基準仍然是合法的度量——它就是當初拿來比的東西——
但**不能掛一個會回傳別的東西的指令當標籤**。

順帶更正的是 `now` 欄（三輪過期）與由它推導的結論：
`129,199 → 136,281 bytes`、`+38.2% → +45.8%`；`execute-mode.md` 那一列從 `−559` 翻成 `+2,332`，
所以「有一列是減少的」這句話也不再成立。附帶那句「自 round 24 起未變」是**退場而非重述**：
它寫下時為真，之後幾輪把它推翻了。

### 4.40 「先選好工具」擋不住一個會自己選答案的工具

Round 60 把 `printf … | { a || b || c }` 改成先用 `command -v` 選、再餵輸入，並加了兩向量的
known-answer test。Round 70 的 reviewer 指出這道防線缺一角，而缺的那一角剛好是它自己造成的：

```
command -v sha256sum   →  匯入的 shell 函式也算「有這個命令」
then sha256sum         →  於是跑的是那個函式
```

known-answer test 只能擋**常數**——回答永遠固定的工具。但一個**會看輸入的**函式（adaptive）可以：
空字串回 `e3b0c442…`、`abc` 回 `ba7816bf…`，兩個向量都對，通過檢查；接著對每一個真實 URL
回同一個固定值。於是 Phase 0 批准的目的地和 Phase 2 比對的目的地**摘要相同**，
「目的地有沒有變」這個問題永遠答「沒變」。批准與目的地的綁定就此失效。

修法是把**呼叫**改成 `/usr/bin/env sha256sum`（`shasum` / `openssl` 同理）。`env` 只查 PATH，
而 bash 拒絕**匯入**名字含斜線的函式（實測 2026-08-22：`BASH_FUNC_/usr/bin/env%%` 讓 bash 印出
`error importing function definition`，接著跑的是真的那一個），所以**可匯入的**那條管道整條關掉。
關不掉的是另一條，而且本文件自己早就記過：呼叫端的 shell 若 source 過啟動檔，
`function /usr/bin/env { …; }` 就能在**本地**定義並攔截這個絕對路徑（同日實測印出 `INTERCEPTED:sha256sum`）。
那是 §4.23 表格「`BASH_ENV` 在呼叫端自己的 shell 裡定義 `/usr/bin/env`」那一列的狀態——
step 0a **偵測**得到（在那些變數還看得見的期間），沒有任何一層關得掉。選擇仍用 `command -v`：
兩者不一致時（只有函式、沒有 binary）`env` 會失敗、`_H` 為空、KAT 不過、digest 清空——
**fail-closed**，正是要的方向。

| | 舊（bare word） | 新（`/usr/bin/env`） |
|---|---|---|
| 匯入常數函式 | KAT 擋下 → digest 清空 | 函式被忽略 → 真實 digest |
| 匯入 adaptive 函式 | **KAT 通過 → 兩個目的地相同** | 函式被忽略 → 真實 digest |
| 只有函式、無 binary | 用函式 | `env` 失敗 → digest 清空（拒絕）|
| PATH 被換成假的 | defeated | defeated（見下）|
| 呼叫端 shell 已本地定義 `/usr/bin/env` 函式 | defeated | defeated（§4.23；step 0a 只偵測）|

最後一列不是遺漏而是**已載明的邊界**：`pre-push-gate.sh` 的註解早就寫著這一段只把攻擊從
「回一個常數」抬高到「假扮 SHA-256」，PATH 前提才是真正扛重量的。
這次修的是**可匯入的**那條函式管道；本地定義的那條和 PATH 前提一樣，仍在 §4.23 劃的邊界內。

**`scripts/pre-push-gate.sh` 不需要同樣的拼法，而它不同並不是不一致**：它的 shebang 是
`#!/usr/bin/env -S bash -p`，privileged mode 根本不匯入環境裡的函式。SKILL.md 的 fence 沒有自己的
shebang——它們被貼進一個既存 shell 執行。**防線不同是因為通道不同**，這句話寫進兩份文件的註解裡，
免得下一輪有人把它們「統一」回去。

### 4.41 兩個意思相反的 exit status，被 `if !` 併成同一條分支

`git rev-parse --verify --quiet` 的 1 是「這個 ref 不存在」，128 是「這個 repository 讀不動」。
Phase 0 寫的是 `if ! … ; then echo "new branch"`，於是 128 走進了 1 的分支：
一個讀不動的 repository 被報成「新分支」，然後 phase 繼續——而這個 phase 的契約寫著
「基礎設施失敗要 hard-abort」。

這和同一段上方註解拒絕的 `2>/dev/null || echo "new branch"` 是**同一個形狀，只是往內一層**，
而且方向一樣：**併起來之後留下的是那個令人安心的讀法**。這就是它十輪沒被發現的原因——
壞掉的時候，畫面看起來像一切正常。

修法是把狀態接出來 `VERIFY_STATUS=$?` 再 `case` 三路：1 → 新分支、0 → 讀 count、`*` → 拒絕。
`*` 涵蓋 127（`env` 本身跑不起來）等一切非預期值，不需要逐一列舉。

### 4.42 把 wrapper 剝掉再測 body，wrapper 自己就沒被測過

Round 69 為 `PUSH_GATE` 探測寫了一個測試，斷言 body 裡的每個命令字都是絕對路徑
（`/usr/bin/grep`、`/bin/echo`）。它的作法是先把 `PUSH_GATE=$(bash -c '` 這層外殼**字串剝掉**，
再執行裡面的內容。於是外殼那個裸 `bash` 從頭到尾不在受測範圍內——
而 `bash` 和它裡面那些字一樣可以被匯入函式宣稱，差別只在**它吞掉的是整個 subshell**：
body 一行都不會跑，`PUSH_GATE` 直接由呼叫者寫定。

**測試的取樣邊界本身就是一個假設，而這個假設沒有人測。** 修法有兩半：
外殼改 `/bin/bash -c`（並在 frontmatter 補上 `Bash(/bin/bash:*)` 授權），
測試改成**執行整條賦值敘述**，再附一個把它改回裸 `bash` 的反向控制——
後者實測印出 `PUSH_GATE=[referenced]`，證明這個洞真的存在過。

### 4.43 拒絕的 exit status 不是 1

補測試時量到一件事：`SD0X_…_REFUSED=` + `: "${VAR:?…}"` 這個拒絕形式，
在 **GNU bash 3.2.57（arm64-apple-darwin25，本機 `/bin/bash`）回傳 127**。
這一行原本接著寫「較新的 bash 回 1」——**那不是量出來的，是推的**。2026-08-22 補量：
GNU bash 5.3.15（aarch64-apple-darwin25.4.0，`/opt/homebrew/bin/bash`）同樣回傳 **127**，`/bin/sh` 也是。
兩個相差二十年的版本都是 127，所以「版本相依」這個結論撤回，只留下量到的那兩筆。
本文件另一種拒絕形式 `PUSH_BLOCKED=1; exit 1` 則穩定回 1。

原本的守衛測試斷言 `status === 1`。照抄下去，新加的四個守衛會在**它們完全正常運作**的情況下讓測試變紅，
而且紅的是 `${VAR:?}` 這個拼法的 exit status，不是守衛本身。所以斷言改為「非零且非 signal」——
這個寬度不依賴 127 這個特定值，而那正是把它寫寬的理由：這個值是 bash 的實作細節，不是它給的契約。

值得寫下來的是它的反面：**任何檢查 `$? -eq 1` 的呼叫端都會把這個拒絕讀成成功。**
本 repo 目前沒有這種呼叫端（拒絕就是整個 shell 結束），但這是拼法帶來的義務，不是可有可無的細節。

### 4.44 本輪的掃描定義：五個 class、十四處修補，不是六個位置

Reviewer 指名六處。照 round 69 立下的規矩，先把 class 掃完再修。
下表的「修補站」欄每一格都是量出來的，指令列在右欄——**這一節初稿寫的是「三個 class、11 處」，
是我從六筆 finding 順手歸納的，沒有量。**（(c) 少算了 resume 的 `git tag -l`，而 (d)、(e) 兩個
class 我在 §§ 4.41–4.42 各寫了一整節，卻沒放進這張表。）本輪 doc 面有兩筆 finding 正是這種
「順手寫下的數字」，寫在這裡的更正也不例外。

| Class | 掃描條件 | 修補站 | 量法 |
|-------|---------|-------|------|
| (a) `command -v` 選中函式、卻以裸字呼叫 | `command -v <tool>` 後接同名裸字 | **6** | `grep -c 'then /usr/bin/env sha256sum'` 兩檔 = 2 + 4 |
| (b) 管線的狀態來自最後一段 | 尾端接 `grep`/`awk`/`wc` 等非絕對路徑過濾器 | **1** | `grep -c 'MERGED_PRS=\$(/usr/bin/grep'` |
| (c) 命令未檢查狀態、後續命令覆蓋 `$?` | fence 內頂層命令，其後還有命令 | **6** | 本輪新增的 `if !` 守衛計數 |
| (d) 兩個意思相反的狀態被 `if !` 併成一條分支 | 對 exit code 有多種意義的命令用 `!` 取反 | **1** | `grep -c '^VERIFY_STATUS=\$?'` |
| (e) 外層 interpreter 本身是裸字 | `$(bash -c` / `$(sh -c` | **1** | `grep -c 'PUSH_GATE=\$(/bin/bash -c'` |

**(b) 與 (c) 有一處重疊**：resume 的 `EPIC_LOG=$(git log …)` 同時是「加了守衛」和
「不再靠管線判斷狀態」，所以 6 + 1 + 6 + 1 + 1 = 15 之中，**去重後是 14 處**。
把重疊算兩次會讓這張表看起來比實際多修了一處。

(a) 掃出的第七站是 `scripts/pre-push-gate.sh`，判定為**非缺陷**（§ 4.40 的 `bash -p`），
並把理由寫進註解——這是本輪唯一一個「掃到但不修」的位置，記下來是為了它不要被當成漏網。

### 4.45 一個 fence 消費了自己沒有推導的變數

Step 5 的目的地驗證用 `"$PUSH_URL"` 去問遠端「這個 ref 現在指向哪裡」，
而**同一個 fence 從來沒有指派過 `PUSH_URL`**——它只在 705 行讀出 `PUSH_URLS`
（`PUSH_URLS=$(…) || PUSH_URLS=`），沒有取出單一值。

這個缺陷有兩張臉，而只有其中一張會在測試裡出現：

| 執行環境 | `PUSH_URL` 的值 | 結果 |
|---------|----------------|------|
| 全新 shell | 空 | `ls-remote -- ""` 失敗 → `FINAL_LOOKUP_FAILED=1` → `unknown` → **每一次 iteration 2..N 的 force-push 都被擋** |
| 沿用的 shell | 上一輪 iteration 留下的值 | 驗證的是**上一輪解析出的目的地**，而不是這一輪的 |

第一張臉是壞掉但安全的；第二張臉是「答對了問題、問錯了倉庫」。
測試若只在乾淨 shell 跑，看到的永遠是第一張——**一個沒被推導的變數在那裡只是空的**。

同一份文件的另外兩個 fence（1164 行的 iteration gate、1547 行的 rollback）
早就寫對了：在讀清單的**同一個條件式裡**取出 `PUSH_URL`，並在查詢前用
`[[ -z "$PUSH_URL" ]] || [[ "$PUSH_URLS" != "$PUSH_URL" ]]` fail-closed。
Step 5 兩樣都沒有。修法就是把那兩樣補上，不是發明新寫法——
`push-ci` 的 Phase 2 也是同一個形狀（`[[ -z "$PUSH_URLS" ]] || [[ "$PUSH_URLS" == *$'\n'* ]]`）。

**為什麼既有測試是綠的**：`probeFence()` 抓的是 `if REMOTE_LS=` 那兩個 fence，
Step 5 用的是 `FINAL_LS`，從來不在取樣範圍內；而 `runBundledClassifier()` 抽的是決策
`case`，再**注入**一個 `FINAL_READING`——本輪的缺陷正是「上游從來沒產出過那個值」。
新測試 `step5DestinationSlice()` 因此執行**完整的推導**：兩段接起來之前先斷言
中間沒有任何一行重新指派 `PUSH_URL`／`PUSH_URLS`，否則這個切片就是對文件的主張而不是對文件的讀取。
反向控制**同時**還原兩半（推導與唯一目的地守衛），並在環境裡 seed 一個
`https://stale.example/previous-iteration.git`——只 unset 的話舊寫法會 fail-closed，看起來就像是對的。

### 4.46 `cmd` 之後接一行 `STATUS=$?`，在繼承的 errexit 下永遠跑不到

round 70 為了把「被覆蓋的 `$?`」修掉，引進了三個 `cmd` + 次行 `STATUS=$?` 的站點。
這個形狀自己帶了一個新問題：**在 `set -e` 之下 shell 在失敗的那個命令就結束**，
次行的捕捉根本不會執行，於是那個為失敗寫的 `case` 分支永遠等不到它要分類的值。

| 站點 | 合法的非零狀態 | 在 errexit 下失去的 |
|------|--------------|-------------------|
| `push-ci` Phase 0 的 `rev-parse --verify --quiet` | 1 = ref 不存在（**這個 phase 最平常的輸入**） | 「new branch」這一行 |
| `epic-merge` Step 5 的 push | 非零 = 沒推上去 | 「PR 仍指向 rebase 前的 commit，Steps 6-9 不可執行」 |
| `epic-merge` resume 的 `grep` | 1 = 還沒有任何 merged PR | 整個 resume |

修法是讓 `if` 自己消費狀態：`if cmd; then S=0; else S=$?; fi`。
被 `if` 消費的命令不是 `set -e` 會動手的命令，所以分類活得過它要分類的那個失敗。
`skills/smart-rebase/SKILL.md:142` 早就是這個寫法，不是新發明。

**誠實的嚴重度**：這一類丟掉的是**診斷**，不是守衛。push 失敗時 errexit 讓 shell 直接死掉，
Step 6 同樣不會跑——反向控制把這件事一起斷言下來，免得日後有人把它讀成「曾經漏過一次 retarget」。
真正的代價是操作者停在一個沒說原因就結束的 shell 裡。

**一個排版上的細節，理由不只排版**：Step 5 的 `then` 獨立成行、push 指令維持不縮排。
`git push` 之後的所有字都會被 byte pin 與 forbidden-flag 掃描讀成這個 push 自己的 argv；
尾巴接一個 `; then`，等於往那裡塞兩個 git 從來看不到的字。

### 4.47 兩個同名的測試 helper，後者靜默覆蓋前者（自查發現）

round 70 在 `test/skills/push-ci.test.js` 末尾追加測試時，一併追加了第二個
`function commitsAheadBlock()`。JS 的函式宣告會提升，**後宣告的那個對全檔所有呼叫端生效**——
於是從 round 70 起，一個更早的測試一直在讀我的區塊，而它的名字說它讀的是自己的。
兩個測試測同一段，其中一個的描述是假的。

這一輪合併成一份定義，並且把錨點綁在文件自己命名的步驟（`# 5. Commits ahead of remote`）上，
而不是綁在「檔案裡最後一個同名函式」這個位置關係上。
**被遮蔽的 helper 在呼叫端是看不見的**，這就是為什麼錨點要在 helper 裡被斷言，
而不是留給宣告順序決定。

### 4.48 本輪的掃描定義與計數

兩個 class 都先掃完再修。Class (b) 的每個數字都附可重跑的推導命令；
Class (a) 不行，原因寫在它自己的段落裡——**能重跑的和不能重跑的要分開講**，
不然讀者會以為整節的數字都可以照著驗。

**Class (a)：fence 讀取一個自己沒有指派的變數**

掃描是用一支寫完就丟的腳本做的：逐個 ```` ```bash ```` fence 收集指派名與讀取名，取差集。
那支腳本**沒有進版控**，所以下面的 11 與 10 這兩個數字，
從現在的工作樹是**重跑不出來的**——這一節先前寫成「每個數字都附推導命令」並點名
`node r71scan.js`，那個檔案不存在，是錯的說法。要重建的話定義如上，但差集的邊界
（`${VAR:-default}` 算不算讀取、`case` 分支裡的指派算不算指派）會直接改變總數，
所以重建出來的數字只會接近、不會相等。

留下來能查的是**判定**而不是總數：下表每一列都指名了站點或檔案，逐條可查。
把一個不可重跑的計數寫成可重跑的，比承認它不可重跑更糟——這是這段改寫的理由。

| 掃出 | 判定 |
|------|------|
| 11 | 1 個真缺陷（`epic-merge` Step 5 的 `PUSH_URL`）|
| | 8 個是 fence 自己在**回報**的環境變數（`GIT_SSH_COMMAND` 等四個，兩檔各一組）|
| | 1 個是解析器誤報（`case` 分支裡的 `0) VAR=… ;;` 指派，正則沒涵蓋）|
| | 1 個是 `codex-setup` 一行示意 fence 裡的 `$hook` |

掃描器本身會過度回報，這裡照實記：修完之後重跑仍是 10 筆，因為那 10 筆本來就不是缺陷。

**Class (b)：`cmd` 之後單獨一行 `STATUS=$?`**
（`grep -rn '[A-Za-z0-9_]=\$?' skills/ scripts/ hooks/` = 47 筆總出現，
其中 `|| VAR=$?` 形式 13 筆、`if …; then X=0; else X=$?; fi` 形式 8 筆；
`grep -c '^[[:space:]]*[A-Za-z0-9_]*=\$?$'` 逐檔加總 = 23 筆單獨成行的捕捉）

下表切的是**修完之後**那 23 筆的現況，不是「本輪處理過幾個站點」——
這兩個問題的答案不同，混在一欄裡就會出現列加總比標題大一的算術錯誤（先前是 3+11+8+2=24）。
本輪修掉的真缺陷有 **3** 個站點，其中 1 個修完後已經不是「單獨成行的捕捉」，
因此不在這 23 筆裡；另外 2 個改寫成 `else` 分支後仍符合這條 grep，列在第一列。
**23 是 round 71 收尾當下的讀數，不是這份文件永遠的讀數**：round 72 在 `push-ci` Phase 2
補了一個 `PUSH_STATUS=$?`（§ 4.51），現在同一條 grep 是 24。
一個沒有標時間點的計數，下一輪就會被自己的改動推翻。

| 23 筆單獨成行的捕捉（round 71 修完當下測得） | 判定 |
|--------------------|------|
| 2 | 本輪修掉的 3 個真缺陷中，改寫後仍住在 `else` 分支、仍被這條 grep 數到的 2 筆 |
| 11 | 包在 `set +e` … `set -e` 視窗內（`commit-msg-guard.sh`、`dep-audit.sh`、`review.sh`、`sanitize-pr-content.sh`）——**不是缺陷** |
| 8 | 所在腳本沒有 `set -e`，且以 `/bin/bash -p --` 執行、不繼承（`smart-commit-inspect.sh`／`-execute.sh`）——**不是缺陷** |
| 2 | `codex-setup` 的 `__sd0x_rc` / `__sd0x_cm_rc`：**刻意**的兩容器拒絕，在 `set -e` 下於失敗的 gate 當場結束、帶著 gate 自己的狀態，兩條路都是拒絕 |

最後兩筆這一輪補了一個字：原本的說明只點名 `__sd0x_rc`，另一個同形狀的站點沒被寫進去。
一次「統一寫法」的掃描會先找到沒被點名的那個——**邊界沒寫下來，就等於沒有邊界**。

### 4.49 核准綁的是「名字」還是「物件」

Step 5 與 `/push-ci` Phase 2 的 push，refspec 左邊原本都是分支名：
`"refs/heads/${head}:refs/heads/${head}"`。上面所有分類——fast-forward 判定、lease 值、
「這次改寫的 ref 是不是共用的」那個 attestation——問的都是**某一個物件**；
而 `refs/heads/${head}` 是一個**名字**，git 會在自己的 process 裡再解析一次。

兩者之間的空檔是真的：另一個 worktree 剛結束的 rebase、第二個 agent session、一個編輯器，
都可以在 `rev-parse` 填完值之後、git 解析 refspec 之前把分支移走。
lease 綁的是**目的地**（`--force-with-lease=<ref>:<expect>` 在遠端動過時拒絕），
沒有任何東西綁來源。於是最安靜的那條路——判定成 `fast-forward`、不需要 unshared attestation
的那條——會把一個沒有被任何分類看過的物件推上去。

改法是左邊放物件 ID：Step 5 用 `$PUSHED`，Phase 2 用 `${PLAN_HEAD_SHA}`。
物件 ID 在這裡和 git 解析之間沒有任何東西能移動它。

`[[ -n "$PUSHED" ]]` 不是多餘的。左邊是空字串時 refspec 變成 `":refs/heads/${head}"`，
那是 git 拼「**刪掉這個分支**」的寫法。要走到那裡，得先讓 `unknown` 分支的 `exit 1` 被一個
匯入的 `BASH_FUNC_exit%%` 接走並 return——這份文件在別處早就把這個情境當前提；
補上一個 `[[ ]]` 的成本是零。

### 4.50 `-u` 遇上 SHA 來源會靜默失效

改成物件 ID 之後 `-u` 就壞了。2026-08-22 在 git 2.55.0 上量的：
`git push -u origin "<sha>:refs/heads/feat/x"` **成功**，但 `@{u}` 之後回
`fatal: no upstream configured`——來源不是分支名，`--set-upstream` 沒有東西可以綁。
一個 exit 0 的 push 加上一個沒有設好的 upstream，正是最難察覺的那種失敗。

round 63 因此判定「不能用 SHA 當來源」。那個**測量是對的，結論是錯的**：
它只試了 `git branch --set-upstream-to`（需要先 fetch），沒有試更直接的路。
同一天量到 SHA 來源的 push **仍然會更新 `refs/remotes/origin/feat/x`**（git 預設 fetch refspec
照樣適用），所以直接寫兩行 config 就完整重現了 `-u`：

```
git config branch.feat/x.remote origin
git config branch.feat/x.merge  refs/heads/feat/x
```

`@{u}` 解得開，`git status -sb` 顯示 `## feat/x...origin/feat/x`，**不需要 fetch**。

「完整重現」講的是**寫進去的鍵與值**，不是「一定會成功」。`-u` 是隨 push 一起成功或一起失敗的；
拆成 push 之後兩條命令，等於把一個結果拆成兩個，於是多出一種舊形式產生不出來的狀態：
**push 成功、upstream 沒寫成（或只寫了一半）**。round 73 補上 `UPSTREAM_STATUS`，
並且它的拒絕訊息和 push 失敗那條**刻意不同句**——commits 真的在遠端了，
這時候跟操作員說「什麼都沒發布」會害他去重推一個已經在那裡的東西（§ 4.56）。
於是 `-u` 從兩個 push 形式裡拿掉，upstream 改由 push **之後**兩行 `git config` 寫入；
四種組合的 push 命令從 4 種塌成 2 種。

寫入必須 gate 在 push 成功上。一個指向「從來沒被發布過的分支」的 upstream，
比沒有 upstream 更糟：它會讓後續每一個 `@{u}` 讀出一個不存在的東西。

`--force-if-includes` 會不會也被 SHA 來源弄成無聲的 no-op？rollback 那條 push 是唯一
真的靠它的路，所以先量再改，而且刻意把 lease 條件**設成滿足**，這樣被拒絕就只可能是旗標的功勞：

| 來源 | 旗標 | 結果 |
|------|------|------|
| 分支名 | `--force-with-lease --force-if-includes` | exit 1，`(remote ref updated since checkout)` |
| SHA | 同上 | exit 1，同一句拒絕 |
| SHA | 只有 lease | exit 0，`(forced update)` |

第三列是反向控制：沒有它，前兩列的拒絕可以被讀成 lease 擋的。旗標活著。

### 4.51 一個 `if` 當作 fence 的最後一條命令

`-u` 拿掉之後，Phase 2 的結尾變成：

```
PUSH_STATUS=$?
if [[ "$UPSTREAM_OWED" = 1 ]] && [[ "$PUSH_STATUS" = 0 ]]; then
  git config ...
fi
```

**這是我這一輪自己種進去的缺陷。** 複合 `if` 區塊的離開狀態，是它裡面最後執行到的那條命令；
條件為假時就是 0。而「條件為假」正是 push 失敗會產生的狀態——於是 fence 以 0 結束，
Phase 2 讀起來像完成了，呼叫端接著去 dispatch `/watch-ci`，監看一個根本沒推上去的 push。

抓到它的不是我，是既有的測試 21（「a rejected push must fail the fence」）：
expected non-zero，got 0。**這正是那條測試存在的理由**——它不是為了這次的改動寫的，
它是為了「任何時候有人把 Phase 2 的結尾改成一個吃掉狀態的形狀」寫的，而這次那個人是我。

修法是在最後補一段拒絕分支，拼法和區塊開頭那個拒絕一樣：
`exit` 是 builtin，匯入的 `BASH_FUNC_exit%%` 蓋得掉；`: "${VAR:?...}"` 對空值展開是
**shell 自己**的錯誤，非互動 shell 會直接結束，沒有東西可以蓋。狀態值寫進訊息裡，因為 `:?` 帶不動它。

這一段和 § 4.46 拿掉的形狀不是同一件事，值得寫清楚：§ 4.46 拿掉的是「`cmd` 之後單獨一行
`STATUS=$?`」，因為繼承 errexit 時 shell 死在 `cmd`，那一行永遠跑不到。這裡 `$?` 也在自己一行上，
但它後面接的是一個**寫入動作**——errexit 下 shell 會死在失敗的 push，寫入就不會發生，
這正是我們要的；而 errexit 沒開時，`PUSH_STATUS` 才是判斷該不該寫的唯一依據。

### 4.52 一個分類 fence 沒有綁自己會用到的名字

`epic-merge` rollback 的分類 fence 讀 `${head}` 和 `${N}`，但那是一個**獨立的 shell**
（§ Names in commands），Step 0 的綁定不會過來。沒綁的話：

- `"refs/heads/${head}"` 變成 `refs/heads/`，一次關於「沒有這個分支」的查詢；
  它的空答案被這個 fence 讀成**head 已被刪除**
- `"backup/pr-${N}^{commit}"` 變成 `backup/pr-^{commit}`，解不出東西，`BACKUP` 空掉，
  於是每一次合法的 rollback 都被分類成 `unknown`

兩個判定講的都是一個空名字，而不是操作員正被要求核准的那次 rollback；
而 `unknown` 會把一次原本無害的復原也送進改寫授權路徑。繼承 `set -u` 時更早——直接在 `${head}` 上中止。

補的是 iteration gate 早就有的那組綁定，用同樣的形狀，補給唯一漏掉的那個 fence。

### 4.53 「兩個 force-push 位元組相同」——從 round 60 起就不成立

兩個 fence 旁邊各寫了一段話，說這兩條 force-push 是刻意保持位元組相同的，
所以守衛必須另起一行、不能寫進 push 那一行裡。

守衛另起一行的**結論是對的**，理由是錯的：真正的理由是 `push` 子命令之後那一行上的所有字，
會被 byte pin 和禁用旗標掃描一起當成這次 push 的 argv 讀，寫進去的守衛會在那裡放進
git 從來看不到的字。至於位元組相同——round 60 給了 Step 5 一個帶值的
`--force-with-lease=<ref>:<expect>` 並從它拿掉 `--force-if-includes`（在 git 2.55.0 上量過，
lease 帶值之後那個旗標是靜默 no-op）之後，兩條就不一樣了。

這段話寫了**兩份**，兩個 fence 各一。只改一份就是這個 loop 已經付過三次學費的那個形狀：
留下來的那份會在下一次 review 被當成新的發現。兩份一起改。

### 4.54 harness 從外面餵進受測 fence 沒綁的名字

`runEpicProbe` 的註解早就寫著：「操作員會替換 `<quoted …>` 欄位，harness 就在同一個位置做同一件事，
而不是把 `head` 和 `epic` 從外面 export 進一個沒有綁定它們的 fence。」

同一支 harness 的 env 裡有一行 `N: '3'`。

也就是說 § 4.52 那個缺陷之所以能活到 round 72，不是因為沒有測試，
而是因為**測試把答案供給了受測對象**：每一個 rollback 案例都通過，因為 `N` 是 harness 綁的。
把 `N` 從 env 拿掉、改成和 `head`／`epic` 一樣的欄位替換之後，四個案例立刻以 bash 語法錯誤失敗——
那個錯誤就是缺陷本身。

同一輪補上的是「**問了哪一個 ref**」這個斷言。harness 的假 `ls-remote` 對每個 ref 回同一個答案，
所以一個查 `refs/heads/`（未綁 `${head}` 的形狀）的 fence，解出來的 tip 一模一樣，
上面每一條斷言都會過。**測 sha 不等於測 ref 名**——這是為什麼這個缺陷在有測試的情況下還是漏了。

教訓寫成一句：harness 提供的每一個環境值，都要問一次「受測對象是不是本來就該自己有這個值？」
如果是，那這個值不是 fixture，是答案。

### 4.55 兩個空字串通過不等式，冒號左邊為空是刪除

`"" != ""` 為**假**。一條寫成不等式的守衛，因此對「兩邊都空」是**放行**的，
而且放行的樣子和「兩邊相等」完全一樣——讀不出差別。

`/push-ci` Phase 2 的形狀正是這樣：

```bash
if [[ "$HEAD_SHA" != "$PLAN_HEAD_SHA" ]]; then   # 兩個都空 → 假 → 往下走
```

往下就是 push 站，refspec 組成 `${PLAN_HEAD_SHA}:refs/heads/${BRANCH}`。
**冒號左邊為空是 git 拼「刪掉這個 ref」的方式**，所以一個要發布 commit 的流程，
在兩個變數都空掉的情況下會刪掉遠端分支。

`pre-push-gate.sh` 攔不到：`:389` 起的 rewrite 測試要求兩邊 OID 都非空才往下判定，
刪除依設計不進它任何一個提示（`rules/git-workflow.md` § Push safety 記的就是這條邊界）。
同一個 repo 裡 `epic-merge` 的 push 上有 `[[ -n "$PUSHED" ]]`——同樣的守衛、同樣的理由，
那邊補了、這邊沒有。**一個防護加在一處而沒加在對稱的另一處，是最容易漏的形狀**：
兩處長得夠像，讓人以為看過的就是這一處。

修法用兩道獨立機制（比對前拒空、push 站再獨立確認一次），
測試逐道拿掉驗證另一道仍成立，兩道都拿掉才讓 argv 記到 `:refs/heads/feat/x`。
斷言看得到那個冒號本身，不只是「離開狀態非 0」——
非 0 有很多種原因，但只有一種會讓遠端少一個分支。

### 4.56 push 落地、上游寫入失敗，被報成「什麼都沒發生」

§ 4.50 把 `-u` 換成兩筆 `git config` 之後，兩筆的離開狀態沒有人接。
於是有一種狀態沒有名字：**commits 已經在遠端了，但 `branch.<n>.remote` / `.merge`
沒設或只寫了一半**。fence 對它回報成功。

危險的不是漏設上游——那是手動一行能補的。危險的是**如果把它報成失敗**，
操作員會做的第一件事是重推。所以拒絕訊息的措辭本身就是防護：
先說「**COMMITS ARE PUSHED；不要再推**」，再給補設的兩行指令。

```
⛔ the push published <branch>, but the upstream write exited <n> —
   branch.<n>.remote / .merge may be unset or half-written. The COMMITS ARE PUSHED;
   do not push again. Set the upstream by hand, then continue: …
```

一般的錯誤訊息只要說「哪裡壞了」。**跨越了不可逆操作的錯誤訊息還要說「哪些已經發生了」**，
否則它會誘發第二次不可逆操作。

### 4.57 跨 fence 的交接寫不出去，最後一行看不見

`epic-merge` Step 7 用 `/usr/bin/printf` 把 PR head SHA 交給 Step 8。
交接失敗時沒有人接狀態，fence 最後一行 `[[ -z "$PUSH_BLOCKED" ]]` 照樣回報成功，
Step 8 便會拿呼叫端**以為**的 SHA 去 `--match-head-commit`。

修法是 `REPORT_STATUS=$?` 加一段拒絕。這裡刻意不用 `|| { … }`：
有兩條測試以逐字 bytes 釘住那行 `printf`，改成 `||` 形式會動到被釘的那一行。
`$?` 另起一行在這裡是安全的，理由和 § 4.46 拿掉的那個形狀相反——
接在後面的是「失敗時本來就不該發生的寫入」，errexit 殺掉 shell 正是想要的結果。

**這一節真正要留下來的是量測，不是修法。** 想驅動這個失敗，直覺是把 fd 1 關掉：

```
$ bash -c 'exec 1>&-; /usr/bin/printf "x\n"; echo "status=$?" >&2'
status=0
```

macOS 的 `/usr/bin/printf` **不回報關閉的 stdout**。改試 `/dev/full` 被 sandbox 擋下
（`Operation not permitted`——那個 1 來自重導向失敗，不是 printf）。
也就是說：一個用 `exec 1>&-` 寫成的測試會**通過，而且什麼都沒驗到**，
看起來卻很像測過了。這比沒有測試更糟。

改成測**狀態管線**：把交接指令換成一個依指定碼離開、但**照樣印出同樣 bytes** 的等價指令。
「照樣印出」是必要的——若替換品同時不印，那條拒絕會因為「根本沒交接」而通過，
不是因為「交接失敗了」。加上反向控制（同時拿掉捕捉與分支 → exit 0）
與一次**未改動原文**的執行（確保 fixture 不會退化成只測自己），三者一起才構成證據。
限制寫在測試註解裡，明說哪一種執行期案例驅動不出來、為什麼。

### 4.58 「actually rewrites history」兩個方向都不準

這句話在四個站點描述 gate 的第二類提示，而它對實際行為**兩邊都偏**：

| 方向 | 事實 |
|------|------|
| **窄了** | `:389`–`:391` 要求兩邊 OID 都非空**且相異**才往下判——ref 的**建立**、**刪除**、OID 未變，三者都不進這一類 |
| **寬了** | `:392` 用 `!` 否定 `merge-base --is-ancestor`，把「不是祖先」和「祖先測不出來」（圖壞掉、讀不到）壓進同一條分支——fail-closed；既有 tag 再被 `\|\| is_tag_ref` 整個覆寫，連前進的更新都算 |

準確的說法是「**不是可證明的 fast-forward**，且逐 ref class 判定」。
`rewrites history` 聽起來像在描述一個客觀事實，但 gate 判的是**它能不能證明不是 rewrite**——
這兩件事在圖讀不到的時候會分岔，而那正是最需要提示的時候。

四個站點，**按內容指名而不按行號**——行號每改一次檔就失效一次，而這一節列出它們的目的正是讓
讀者去複查「四份是不是都改了」，指到無關內容的行號會讓複查落空（round 74 就是這樣被抓到的）：

| 站點 | 改成哪一種說法 |
|------|---------------|
| `skills/push-ci/SKILL.md` Phase 0 protected-branch 流程說明 | 完整版：`not provably a fast-forward`，並就地寫出 fail-closed 與逐 ref class |
| 同檔 § Push safety 複述段 | 完整版，同上 |
| `test/rules/discretion-tiers.test.js` hook 提示類別的註解 | 摘要版：`overwrites an existing ref`——註解只需說清楚「不是只有 protected 那一類」 |
| `docs/cookbook/ship-change.md` Gates 表 Pre-push safety 列 | 摘要版起頭（`overwrites a ref`），其後**兩個方向都展開**寫 |

**四份不共用同一個字串，所以沒有單一 `grep` 掃得到全部**——這件事本身要寫出來，否則下一個人
會拿完整版那句去掃，得到兩筆，然後把「只有兩處」當成結論。要複查就掃兩次：
`grep -rn 'not provably a fast-forward'`，以及 `grep -rn overwrites`——第二個**故意只掃一個字**，
因為 markdown 粗體標記會夾進片語中間：`ship-change.md` 寫的是 `**overwrites** a ref`，
`grep 'overwrites a ref'` 掃不到它。片語掃描在 `.md` 裡本來就不可靠，寧可多掃幾筆自己讀。
（兩次都**不要接 `| head`**，理由見 § 4.59。）

### 4.59 `| head -N` 把「被截斷」讀成「沒有更多」

Round 72 的自查掃描寫成 `grep -rn "byte-identical" … | head -20`。
命中超過 20 行，`head` 切掉尾巴——而**被截斷的輸出和「沒有更多」在畫面上一模一樣**，
沒有任何標記說「還有」。當時讀成後者，於是記錄裡寫下「三處都改了」，
而實際有五處、活了兩處到 round 73。

漏改本身會被下一輪 review 抓到。真正的代價是那句**寫進記錄的完整性宣稱**：
它讓下一輪不再去掃。所以更正必須留在原文旁邊（記錄類文件不就地改寫），
不能只把數字換掉。

規則：**稽核用的 `grep` 一律不接 `| head -N`**。要限制輸出就 `-c` 先數，
或讓它整份印出來——一份長輸出的成本，遠低於一句假的完整性宣稱。

### 4.60 授權一個 commit，卻對另一個 commit 做判定

§ 4.50 把 push 的來源釘成物件 ID，理由寫得很清楚：核准綁在一個 commit 上，
`refs/heads/<b>` 是一個**名字**，git 會在自己的行程裡、在所有判定都下完之後再解析一次。

同一個 fence 裡還有一處在讀那個名字，round 74 才發現：終端拓樸檢查。

```bash
FINAL_LOCAL=$(… git rev-parse --verify --quiet "refs/heads/${BRANCH}") || FINAL_LOCAL=
…
git merge-base --is-ancestor "$FINAL_TIP" "$FINAL_LOCAL"
```

這條 ancestry 的答案決定**要不要問 unshared**。push 送的是 `$PLAN_HEAD_SHA`。
兩者只在中間沒有東西移動分支時相同。

失敗方向是安靜的那一個：分支移到 B → 終檢對 B 讀出 `fast-forward` → 跳過 attestation →
git 用核准的 A 覆蓋遠端。而 tracking ref 與 reflog 已被**同一次移動**更新，
所以 `--force-with-lease` 與 `--force-if-includes` 都會通過。
三道保護沒有一道會擋，因為它們都在問「遠端有沒有變」，沒有一道在問
「我判定的東西和我要送的東西是不是同一個」。

規則寫成一句：**每一個替 push 授權的檢查，都必須綁在 push 實際送出的那個物件上**。
不是「用比較新的方式再讀一次」，是**不要再讀**——`FINAL_LOCAL=$PLAN_HEAD_SHA`。
`/epic-merge` Step 5 早就對 `$PUSHED` 判定，本節是把同一條規則補回 `/push-ci`。

**測試面的教訓比修法重要。** 在此之前假 git 對所有 `rev-parse` 回同一個 `FAKE_HEAD_SHA`，
於是「分支移走了」這個狀態在 harness 裡**根本無法表達**——每個案例都通過，
因為兩側本來就被餵成同一個值。這是 § 4.54 的同一課換一個外觀：
harness 表達不出來的狀態，測試就見證不了，而綠燈看起來完全一樣。

### 4.61 表格上寫著「不要推」，執行面沒有人讀那張表

`/epic-merge` rollback 的分類表自 round 53 起就把 `no-op` 與 `head-deleted` 標成
「只做本機還原、不 push」。執行 rollback 的 fence 對這件事一無所知：
它的 push 前提只有 `[[ -z "$PUSH_BLOCKED" ]] && [[ -n "$PUSHED" ]]`，兩者在那兩列上都是真。

原因是**分類器和執行者是兩個 fence，也就是兩個 shell**。分類器把
`ROLLBACK_READING` 印出來給人看，值不會自己走到下一個 fence 裡。
同一份文件裡 `PUSH_URLS_DIGEST` 是用 `<…written literally and quoted>` 欄位帶進去的——
機制早就在，只是這一個值沒有用它。

於是「別人把這個分支刪掉了」（`head-deleted`）會走到一個可能把它重建回來的 force-push。

補上的閘門有三個性質，缺一不可：以欄位替換綁值（不是從環境 export，§ 4.54）、
`case` 逐列判定、`*` 收尾——**未替換的欄位與空字串都必須落進拒絕臂**，
因為一個沒被替換的 `<…>` 在 shell 眼裡就是一串會被 glob 或原樣傳遞的字，
不是一個會自己喊錯的東西。

一般化：**一張表寫了規則，不等於有東西在執行那條規則。**
要檢查的是「這個值有沒有進到會用到它的那個 shell」，而不是「文件裡有沒有寫」。

### 4.62 授權在被授權的物件產生之前就過期了

rollback 的順序是：分類 → 問人 → `git switch -C` 還原 → push。
被 push 的物件在**第三步**才產生，而分類在**第一步**。中間隔著一次人類互動。

Step 5 因此在 push 前重新量測一次遠端拓樸；rollback 沒有，它靠的是
第一步的分類，加上一個**無值的 lease**。這三件事一起，正好構成一個都能通過的組合：

| 保護 | 它問的問題 | 為什麼在這裡不夠 |
|------|-----------|-----------------|
| 分類器讀數 | 「還原是不是 fast-forward」 | 在核准與還原之前量的，遠端後來可以變 |
| 無值 `--force-with-lease` | 「遠端還在 tracking ref 記的位置嗎」 | 讀的是本機的 tracking ref，不是遠端現況 |
| `--force-if-includes` | 「被覆蓋的東西在我的 reflog 裡嗎」 | `switch -C` **自己就會**把分支原本的 OID 寫進 reflog |

第三列是關鍵：`--force-if-includes` 在這條路徑上會被**這條路徑自己**滿足。
一個由被檢查的操作親手製造出來的證據，不是證據。

修法是在同一個 fence、還原之後重新量測，並且對 `$PUSHED` 量。

> **round 75 推翻了這一節的後半（不要照這一段實作）**。原文接著寫的是「lease 維持無值——那是
> `head-deleted` 那列既有的設計選擇，重新量測本身就足以關掉缺口，改 lease 會在沒有理由的情況下
> 推翻另一個已記錄的決定」。**理由當時就不成立，只是還沒被量出來**：無值 lease 靠的是 tracking
> ref，重新量測關掉的是「量測時點過期」那一半，關不掉「量完之後、push 之前 tracking ref 被背景
> fetch 移動」那一半。§ 4.64 把兩半都量出來了，兩處 push 現在都綁量測值
> （`--force-with-lease="refs/heads/<b>:<tip>"`）並移除 `--force-if-includes`。
> 這一節保留原文是因為它記的是**當時的推理**——照它做會裝回被移除的形式。

### 4.63 `.md` 裡的片語掃描不可靠

§ 4.58 要列出「同一個說法改了哪四個站點」，寫的時候連錯兩次：

1. 先寫「四份都可用一條 `grep` 掃出」。不成立——四份不共用同一個字串，
   兩份是完整措辭、兩份是摘要措辭。
2. 改成兩條 `grep` 之後，第二條仍掃不到 `docs/cookbook/ship-change.md`：
   那裡寫的是 `**overwrites** a ref`，**markdown 粗體標記夾在片語中間**，
   `grep 'overwrites a ref'` 掃不到。

最後改成只掃單字 `overwrites`。留下來的規則有兩條，和 § 4.59 的 `| head` 是同一族：

- **在 `.md` 裡掃片語之前，先想 markdown 的行內標記會不會夾進去**（`**`、`` ` ``、`*`、`_`、換行）。
  寧可掃單字、多幾筆自己讀。
- **「四份都改了」這種完整性宣稱，要附上任何人都能重跑的掃描方式**，
  而不是一組會隨編輯飄掉的行號。§ 4.58 這一節存在的目的就是複查；
  複查手段本身壞掉，整節就等於沒寫。

### 4.64 無值的 lease 讀的全是本機狀態

`--force-with-lease` 不帶值時，git 拿 **tracking ref**（`refs/remotes/origin/<b>`）當期望值；
`--force-if-includes` 拿的是**本機分支自己的 reflog**。兩者都不是遠端現況——而關鍵在於，
**餵飽它們的是兩個不同的動作，兩個都平凡**：一次背景 `git fetch` 把 tracking ref 移到別人推上去的
新 tip（這一件事**只**餵 tracking ref，`fetch` 不寫本機分支的 reflog）；而那個 tip 只要**本機分支
曾經移到它上面過**——在它上面 commit 過再退回、或 `reset --hard` 到它——就已經在分支 reflog 裡。
不需要同一個動作同時做到兩件事，這正是為什麼兩個旗標一起用仍然擋不住。

實測（2026-08-22，git 2.55.0）：

| # | 情境 | 結果 |
|---|------|------|
| A | 帶值 lease，值等於遠端現況 | 接受，rc=0 |
| B | 帶值 lease，值是**分類當時**的 tip，遠端後來被別人移動 | `! [rejected] … (stale info)`，遠端未變 |
| C | 帶值 lease **加上** `--force-if-includes` | 接受，rc=0——旗標在帶值 lease 旁邊是 no-op |
| D | 空期望值 `--force-with-lease=refs/heads/<new>:`，目標 ref 不存在 | 接受；同一形式對**存在**的 ref → `(stale info)` |

端到端重現。**下面是真的跑過的完整腳本**，不是節錄——貼進檔案執行即可，
它自己開臨時 repo、自己清掉，不依賴這個工作樹的任何東西：

```bash
#!/bin/bash
set -u
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/leasebypass.XXXXXX"); cd "$ROOT" || exit 1
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@e GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@e

git init -q --bare remote.git
git init -q work && cd work && git remote add origin "$ROOT/remote.git"
echo base > f && git add f && git commit -qm base && git branch -M main && git push -q origin main
git checkout -qb feat/x && echo c > f && git commit -qam C && git push -q origin feat/x && git fetch -q origin

# (1) D 進入「這個分支自己的 reflog」：操作者在這裡 commit 出 D 又退回去
echo d > f && git commit -qam D && D=$(git rev-parse HEAD) && git reset -q --hard HEAD~1
# (2) 操作者把 C 改寫成核准的 A
echo a > f && git commit -qam A && A=$(git rev-parse HEAD)
# (3) 分類器量遠端：仍是 C
C=$(git ls-remote origin refs/heads/feat/x | cut -f1)
# (4a) 協作者從另一份 clone 把 D 推上遠端
git clone -q "$ROOT/remote.git" ../other
git -C ../other push -q --force "$ROOT/remote.git" "$D:refs/heads/feat/x"
# (4b) 一次背景 fetch 把 tracking ref 移到 D
git fetch -q origin

echo '-- (5) round 74 的形式：無值 lease + --force-if-includes，推核准的 A'
git push --force-with-lease --force-if-includes origin "$A:refs/heads/feat/x" 2>&1 | tail -2

git push -q --force origin "$D:refs/heads/feat/x"   # 把遠端放回 D，同一棵樹再試一次
echo '-- (5) round 75 的形式：lease 綁第 (3) 步量到的 C'
git push --force-with-lease="refs/heads/feat/x:$C" origin "$A:refs/heads/feat/x" 2>&1 | tail -2
cd / && rm -rf "$ROOT"
```

實跑輸出（2026-08-22，git 2.55.0；`C=f133dae`、`D=b641186`、`A=f4e544a`，
第 (4b) 步後 tracking ref 與遠端都是 `D`，`git reflog show feat/x | grep -c b641186` 回 `1`）：

```
-- (5) round 74 的形式：無值 lease + --force-if-includes，推核准的 A
 + b641186...f4e544a f4e544a…dc -> feat/x (forced update)
   remote after: f4e544a

-- (5) round 75 的形式：lease 綁第 (3) 步量到的 C
 ! [rejected]        f4e544a…dc -> feat/x (stale info)
error: failed to push some refs to '…/remote.git'
   remote after: b641186  (D=b641186)
```

第一組把協作者的 `D` 蓋掉了；第二組拒絕，遠端仍是 `D`。

修法：`/push-ci` Phase 2 與 `/epic-merge` rollback 都改成
`--force-with-lease="refs/heads/<b>:$<這個 fence 自己量到的 tip>"`，並移除 `--force-if-includes`。

**空值不是漏洞，是 `creation` 那一列的讀數**（實測 D）。兩個 fence 裡能走到 push 的讀數是封閉集合
——`unknown` 與未具結的 `rewrite` 都在上游被拒——所以量測變數不會在任何**推得出去**的路徑上懸空。

這條規則可以脫離本 feature 讀：**一個保護機制，如果它讀的狀態是被保護的那一方自己能寫的，
它就不是保護機制。** § 4.62 第三列（`switch -C` 自己餵飽 `--force-if-includes`）是同一句話的另一個實例。

### 4.65 「分類之後」是一個獨立的時間窗，兩端都要有拒絕臂

`/epic-merge` rollback 還原前的分類表有 `head-deleted` 一列：別人把分支刪了，只做本機還原、不 push。
但那一列問的是**分類當下**遠端還在不在。刪除發生在分類**之後**，還原後重新量測讀到的是 `creation`
——而 `creation` 原本和 `up-to-date`、`fast-forward` 併在同一支放行。
於是 force-push 會把別人剛刪掉的分支重建回來。

新增獨立的 `creation` 拒絕臂。它不是 `head-deleted` 的複製：兩者判定的是**不同時點**的同一個事實，
所以兩處都要有，刪掉任何一邊都會留下一個沒人守的視窗。

### 4.66 只數呼叫次數，看不出比對的是什麼

還原後的 ancestry 呼叫在測試裡原本只被**計數**。把分類器改成重新解析 `refs/heads/<head>`
（而不是比對即將被推出去的物件）——正是 § 4.60 那個缺陷的形狀——假 git 會回同一個被設定的狀態碼，
**每一項執行面測試都仍然是綠的**。

修法是讓假 git 記下**整個 argv**，斷言 `merge-base --is-ancestor <遠端 tip> <被推物件>`，
並補一個把 `"$PUSHED"` 換成 `"refs/heads/${head}"` 的負向控制。

和 § 4.54 同族，但方向相反：那裡是 harness **表達不出**某個狀態，這裡是 harness 表達得出、
卻只記了一個對兩種實作都相同的投影。**斷言的粒度要比缺陷的粒度細**，否則測試看見的是同一個數字。

### 4.67 URL 被改寫兩次：`insteadOf` 鏈

`git remote get-url --push --all origin` 解析出來的 URL，**再交給任何 git 指令，會再被改寫一次**。

實測 2026-08-22（git 2.55.0），設定 `url.<B>.insteadOf=<A>` 與 `url.<C>.insteadOf=<B>`，遠端 `origin` 指向 `A`：

| 問法 | 答案 |
|------|------|
| `git remote get-url --push --all origin` | `B` |
| `git push`（實際落地） | `B`（`B.git` 多了 `refs/heads/feat/x`，`C.git` 是空的） |
| `git ls-remote -- "<B>"` | **`C` 的 tip**（`e21864d…`，而 B 是 `ec62dc7…`） |

也就是說：推出去的是 B，量測到的 tip 卻來自 C。**每一個把已解析 URL 交回給 git 的地方**都會踩到，
共六處：`/push-ci` 的 Phase 0/1 分類與 Phase 2 最終複查，`/epic-merge` 的兩個 iteration/rollback
分類 fence、Step 5 與還原後複查。後果分兩種，都不只是「量不到」：

| 讀數用途 | 讀錯的後果 |
|---------|-----------|
| 決定要不要問「這些 ref 是不是沒人共用」 | 把 rewrite 讀成 fast-forward，那個問題**根本不會被問** |
| 組 `--force-with-lease` 的值 | lease 綁上**別的倉庫**的 tip——看起來像驗過的 lease |

判斷「這裡要不要加偵測器」的規則是**問的對象**，不是指令長相：問 `origin` 這個**名字**的不會二次改寫，
問一個**已解析字串**的才會。這一點是實測的（2026-08-22，git 2.55.0，同一棵樹、同一組設定）：

```
$ git remote get-url --push --all origin
…/chain77/B.git
$ git push origin HEAD:refs/heads/feat/x        # 落地
B refs: refs/heads/feat/x
C refs:                                          # C 是空的
$ git ls-remote origin                           # 問「名字」
3ae47d4797104b136ba38b29727206bef3474769	refs/heads/feat/x
$ U=$(git remote get-url --push --all origin); git ls-remote -- "$U"
                                                 # 問「已解析字串」→ 空的（問到 C 去了）
$ git ls-remote --get-url -- "$U"
…/chain77/C.git                                  # 偵測器：答案 ≠ 傳入值
```

所以 `/push-ci` 有三處 `ls-remote --upload-pack` 但只有兩處需要偵測器——Phase 0 的可達性 preflight
問的是 `origin`，量到的是正確的 B。

**注意最後一組的形狀**：問已解析字串得到的不是「別的 tip」，是**空輸出**——C 這個倉庫沒有這個 ref。
分類器把空輸出讀成 `creation`（「遠端沒有這個分支」），那正是一個**不必問**的列。
也就是說這個缺陷最自然的表現不是量錯，是**那個共用性的問題根本不會被問**；
而 L1 hook 是 opt-in 的，沒裝的專案裡那個問題就是唯一的憑證。

**這個缺陷從 URL 字串本身無法修復**：任何交回給 git 的字串都會再被改寫一次，沒有「已展開、不要再展開」
的表示法。所以做法只能是**偵測後拒絕**，走既有的 `unknown` fail-closed 路徑——單調，只增加拒絕。

偵測器是 `git ls-remote --get-url -- "$URL"`：它把 URL 過一次改寫表就結束，**純本機、不連線**
（實測：有效 URL rc=0；空字串 `fatal: bad repository ''`、rc=128）。答案 ≠ 傳進去的字串，就是有第二次改寫。
指令失敗也算——讀不到設定不是「沒有改寫」的證據，這是 fail-closed 的方向。

因為它不連線，它是文件裡**唯一**不需要 `--upload-pack=git-upload-pack` 釘住應答程式的 read。測試把
「網路讀」與「本地展開」分成兩組：前者必須釘、後者必須**不帶** `--upload-pack`——後者是拒絕而不是豁免，
一旦某行長出 `--upload-pack`，它就不再是當初被豁免的那種本地讀了。


### 4.68 attestation 不是核准：量測完成後的復原臂漏了一步

三個 fence 在**量測之後**才知道這次推送是 rewrite——`/push-ci` 的最終複查、`/epic-merge` 的
Step 5 與 rollback 還原後複查。三處的復原指示原本都是同一句：

> 把共用性問題按名字問操作者，得到 yes 就帶著 `UNSHARED_ATTESTED` 重跑這個 fence。

少了一步。實際發生的順序是：

```
核准（在「不是 rewrite」的計畫下給的） → 量測 → 發現是 rewrite → 問共用性 → 重跑 → 推
```

`rules/git-workflow.md` § Push safety 固定的順序是**共用性問題按名字問，且在 force 核准之前**。
上面這條路徑把核准放在最前面，而那份核准描述的拓樸已經不成立；attestation 回答的是
「這個 ref 有沒有別人在用」，那不是「我核准把它蓋掉」。同一份規則另有一句管這件事：
**「a plan that shows a plain push while a lease-force runs is not an approval of what happens」**。

修法是把復原臂寫成兩步、標明順序，並說出**為什麼**手上那份核准不算數：

| 步驟 | 內容 |
|------|------|
| 1 | 按名字問共用性問題 |
| 2 | yes 之後，回去要一份**新的**推送核准，計畫要寫明這次會 rewrite、並秀出將帶的 lease 值 |
| 然後 | 才帶著 `UNSHARED_ATTESTED` 重跑 fence |

第 2 步末尾那句「為什麼」不是修辭。少了它，「再問一次」讀起來像官僚流程，而流程是會被跳過的；
寫出「你手上那份核准描述的拓樸已經不成立」，跳過它就成了一個要說出口的決定。

**測試要釘的是順序，不是出現與否**。只斷言復原臂裡同時有「按名字問」與「重新核准」，
一個把兩者順序寫反的臂會通過——而順序正是這條規則的全部內容。所以斷言用的是
`arm.search(QUESTION) < arm.search(FRESH)`，並補一個把核准那幾行刪掉的負向控制。


### 4.69 綁住了目的地、綁住了發布的物件，沒綁住被銷毀的那個

Round 78 自查。到 round 77 為止，`/push-ci` Phase 2 已經把三樣事實綁在核准上：

| 事實 | 綁法 | 何時加的 |
|------|------|----------|
| 目的地 | `PLAN_PUSH_DIGEST` 與重解析的 digest 比對 | round 54 |
| 這次推送**發布**的物件 | `FINAL_LOCAL=$PLAN_HEAD_SHA`（不是重解析 branch 名） | round 74 |
| ref 名字 | `UNSHARED_ATTESTED` 比對 `refs/heads/${BRANCH}` | round 60 |

第四樣沒有人綁：**這次推送要銷毀的那個 commit**。`grep -n 'PLAN_' skills/push-ci/SKILL.md`
當時只回這四個 `PLAN_*`，沒有任何 plan 端的 remote tip。

看起來像已經被蓋住，是因為 round 75 把 lease 改成帶值形式
`--force-with-lease=refs/heads/<b>:$FINAL_TIP`。但那個值是**這個 fence 此刻量到的**——
這正是它在正常情況能成功的原因，也正是它在這裡幫不上忙的原因：remote 移動到 D 之後，
lease 期待的就是 D，於是順利通過。

```
Phase 1   量到 C → 判 rewrite → 按名字問未共用 → 取得具結 → 取得核准
          ↓  （核准之後，同事推上 D）
Phase 2   量到 D → 仍判 rewrite → 具結字串仍對得上 ref 名字 → 放行
push      lease = refs/heads/<b>:D → 符合 → D 被覆寫
```

**這條路徑上，操作者看過的東西比想像的還少。** 本節初稿寫的是「取得核准（計畫寫著覆寫 C）」，
那是錯的——doc plane 的審查者查了 Phase 1 的 Push Plan 模板，當時它只有 Branch、目的地、
Commits、HEAD、Push gate、要執行的指令，**沒有任何欄位說出這次推送要覆寫哪個 commit**。
`C` 只出現在**未共用具結**那個問句裡，而 § 4.68 已經確立「具結不是核准」。epic-merge 的
Step 5 與 rollback 核准問句同樣只寫「This rewrites remote history.」，也沒有物件 ID。

這件事同時改變了修法的形狀。原本只補 fence 端的比對，等於拿「分類器量到的值」冒充
「核准涵蓋的值」——守衛仍然攔得到遠端移動，但它宣稱的理由是假的，而且 round 77 的復原臂
還要求操作者「回到 Phase 1 取得一份寫明它會帶哪個 lease 的新核准」，那個欄位當時並不存在，
指示從落地起就無法執行。所以修法有兩半，缺一不可：

| 半 | 內容 |
|----|------|
| 計畫端 | Push Plan 新增 `Overwrites:` 一行（force 路徑上寫出完整物件 ID，其餘讀數寫 `nothing (<reason>)`）；epic-merge 的 Step 5 與 rollback 兩個 force 核准問句都加上 `replacing <REMOTE_TIP>` |
| fence 端 | 下表的三處比對 |

沒有計畫端那一半，fence 端比對的是一個操作者從未看過的值；沒有 fence 端那一半，計畫寫了
也沒有人驗證它到執行時仍然成立。

具結那一關擋不住，是因為**具結是憑證，不是事實**：它回答「這個 ref 有沒有別人在用」，
沒有回答「要覆寫的是哪個 commit」。而 round 77 加的復原臂只在**讀數改變**時觸發
（`fast-forward` → `rewrite`），這裡讀數兩次都是 `rewrite`，所以走不到。

還有一層：**tip 在兩次量測之間移動，本身就是打臉那份具結**。一個「沒別人在用」的 ref，
不會長出這裡沒發布過的 commit。fence 手上握著這個證據卻沒讀。

修法是把第四樣事實也綁進來，三處同一形狀，欄位留空即拒絕：

| 檔案 | 欄位 | 比對點 |
|------|------|--------|
| `skills/push-ci/SKILL.md` | `PLAN_REMOTE_TIP` | Phase 2 `rewrite` 臂，具結檢查**之後** |
| `skills/epic-merge/SKILL.md` | `APPROVED_TIP` | Step 5 `rewrite` 臂 |
| `skills/epic-merge/SKILL.md` | `APPROVED_TIP` | rollback `rewrite` 臂 |

具結檢查排在前面是刻意的：缺具結是更根本的欠缺，先報它可以少一次來回。

**rollback 那處的價值最高，而且理由跟另外兩處不同。** 回滾要把分支還原成 `backup/pr-<N>`，
而 backup 依定義不含剛被推上去的 head，所以 `rewrite` 是回滾的**正常**讀數。讀數本身因此
完全無法區分「回滾我們自己推的東西」與「別人又在上面推了東西」——tip 是唯一的判準。
另外兩處只是補齊對稱性，這一處是補上原本就不存在的判別能力。

**測試上的坑**：`runRollbackGate({ approvedTip: undefined })` 會被解構預設值
`approvedTip = tip` 吃掉，那一列實際測到的是未漂移路徑（status 0，而不是預期的拒絕）。
「保留佔位符不替換」需要另一個哨兵，現在用 `null`。這類參數預設值造成的**靜默改測**，
和 mutation 沒套用上是同一類問題：測試通過了，但通過的不是你以為的那條路。

### 4.70 拒絕紀錄「沒有東西蓋得過」——這句話把命令和值搞混了

Round 78 之後，三道 fence 的註解都寫著同一句話：`exit` 是 builtin，會被匯入的
`BASH_FUNC_exit%%` 蓋過，所以真正擋住 push 的不是終止子，而是**賦值**——「a refusal RECORDS
itself in an assignment, which nothing outranks」。Round 79 的 code review 指出這句話是假的，
而且假在一個很細的地方：**蓋不過的是那個命令，不是它寫進去的值。**

取代 `exit` 的函式會執行任意程式碼，所以它只要自己再賦值一次就抹掉了那筆紀錄：

```
BASH_FUNC_exit%%='() { PUSH_BLOCKED=; return 0; }'
```

2026-08-22 實測（bash 3.2.57 與 5.3.15 皆同）：拒絕訊息完整印出、旗標被清空、
`[[ -z "$PUSH_BLOCKED" ]]` 通過、push 以 status 0 執行。原本的測試 fixture 只用
`() { return 0; }`——那是**比文件宣稱要抵擋的更弱的攻擊**，所以每一支「imported exit」測試
量到的都不是文件說的那個性質。

**修法是把紀錄凍結，而不是換一個更好的終止子**（沒有更好的：`return` 也是 builtin，
沒有 keyword 能終止 shell）。所有 push 前的拒絕站點改成 `readonly PUSH_BLOCKED=1`：

| 抹除手法 | 對 readonly 名稱的結果（兩個 bash 版本皆同） |
|---|---|
| `PUSH_BLOCKED=` | `readonly variable`，賦值失敗，值保持 `1` |
| `unset PUSH_BLOCKED` | `cannot unset: readonly variable` |
| `declare -g PUSH_BLOCKED=` | `readonly variable` |

共 30 個站點：`push-ci` 8、`epic-merge` 22（19 個與 `exit` 配對，3 個以
`${SD0X_EPIC_MERGE_REFUSED:?}` 展開終止）。

**沒有凍結的四個站點是刻意的**，這是分界所在：`epic-merge` Step 5 之後累積狀態的那幾個
（Step 5 status、Step 6 retarget、Step 7 SHA 解析與 handoff）在它們與 guard 之間**沒有任何
`exit`**，所以這條攻擊向量拿不到執行機會；而把第一個凍結起來，第二個在**正常**執行時就會噴
`readonly variable`。判準是**配對**，不是站點。

#### 這修好的邊界在哪裡——以及沒修好的在哪裡

同一天實測的另一件事必須一起記：能定義 `exit` 的環境，同樣能定義 `git`——

```
BASH_FUNC_git%%='() { echo "HOSTILE GIT ran: $*"; }'   # 整個 push 被攔截
```

所以這**不是**對抗任意函式注入的防線，凍結也不會讓它變成防線。它守的是原本就該守的那件事：
**只信任終止子的情況**——被 stub 掉的 `exit`、被 subshell 吞掉的 `exit`、被寫成條件語境而
失效的 `exit`。`readonly` 讓註解那句話對於**抹除**這個向量成立，如此而已。把它寫成安全邊界，
就會是下一輪 review 該抓的第二個假宣稱。

### 4.71 marker 平衡是兩行註解的性質，不是那段程式碼會跑的證據

Round 79 把三個「這個 hook 有沒有裝 sd0x 接線」的判定從「carries the sd0x stanza」改寫成
「well-formed marker pair」，本意是修掉**被截斷的 stanza**（只剩開頭 marker）被 `doctor` 認證為
`installed` 的問題。Round 80 的 review 指出這個改寫**收窄過頭**：marker 平衡只是兩行註解的性質，
把中間的 body 清空、註解掉、或換成**另一個 hook** 的 script，marker 依然完美平衡——

```
# >>> sd0x-dev-flow pre-push gate >>>
# <<< sd0x-dev-flow pre-push gate <<<
```

——mode-1 的 Active predicate 全部通過，`doctor` 報 `installed × Active` ✅，而實際上沒有任何
gate 執行，protected 與改寫歷史的 push 一個 `/dev/tty` 提示都不會看到。

修法是把「intact sd0x block」定義成**三個子句**並集中在一處，讓三個判定（sync 的 step 2、
`unknown` 列的 disk-evidence、mode-1 Active predicate）共用同一個定義：

| 子句 | 少了它會過關的東西 |
|---|---|
| 開頭與結尾 marker 各恰好一個 | 兩組邊界，覆寫一組另一組還在跑 |
| 開頭在結尾之前 | 數量一樣、什麼都沒框住 |
| 兩者**之間**的行呼叫 `.claude/scripts/<這個 hook 的 script>` | 空 body、被註解掉的 body、指向另一個 hook 的 body |

「presence」與「intactness」是兩個問題：`doctor` 的 grep 回答前者，那對**報告**是夠的；
任何會寫下 `installed` 的判定回答後者。

### 4.72 四格表格不是分割：數量與順序是兩個問題

同一輪的第二筆：那張表的最後一列選擇子寫「Any other marker **count**」，卻在同一列裡舉了
「a closing before its opening」當例子——而那個例子跟第一列**數量完全相同**，差的是順序。
選擇子排除了它宣稱包含的例子，於是「每個檔案恰好落在一列」是假的。

改寫成明確的**程序**，一次只問一個問題：

```
step 1  數量   → 各一個？ → step 2 ｜ 各零個？ → step 3 ｜ 其餘 → step 4（拒絕）
step 2  完整性 → 是 intact block？ → 就地替換 ｜ 順序反了 / body 空的 → step 4
step 3  接線   → 有非註解行引用該 script？ → step 5（legacy）｜ 沒有 → prepend
```

第三筆同樣在 step 3：原本寫「a line referencing」，於是

```sh
# gate location: .claude/scripts/pre-push-gate.sh
```

這樣一行**註解**會讓 `sync --with-push-gate` 判成 legacy wiring、寫入任何東西、記 `pending`，
然後叫操作者去刪一行**檔案裡不存在**的 source。判準改成「非註解行」（去掉前導空白後第一個字元
是 `#` 就是註解）。這個判準刻意**在安全方向上粗糙**：路徑出現在活的命令裡仍算接線——誤判成
legacy 的代價是一個看得懂的拒絕，誤判成乾淨的代價是一行活著的 source 讓每次 push 都失敗、
而且remedy 訊息不會印出來。

### 4.73 `commit-msg` 豁免的是 opt-in，不是接線程序

原文寫「`commit-msg` is unaffected by the matrix above」。它豁免的其實是**要不要裝**（永遠裝、
沒有 `declined` 狀態），而 marker 程序管的是**怎麼寫**。mode 1 給 `commit-msg` 的工件和給
`pre-push` 一樣是兩個（複製的 script + marker 包住的 stanza），而舊版安裝器對 Husky hooks
一律用 append sourcing——所以 legacy `commit-msg` wrapper 不只是可能，是**當初出貨的形狀**。

而且它更需要這個程序，不是更不需要：source 這支 guard 比 source gate 更糟。gate 會拒絕並把
shell 大聲帶走；guard 會 `exec` **取代**呼叫它的 shell（2026-08-22 實測），於是專案自己寫在
`commit-msg` 裡的東西全部**無聲**停止執行。只複製 script 會保留那個 wrapper，只 prepend 會把它
留在原地——step 5 是唯一兩者都不做的答案。

### 4.74 `\Z` 在 JavaScript regex 裡是字面的 Z

修上面那些東西時撞到的：`test/skills/codex-setup.test.js` 的 `section()` helper 用
`(?=^## |\Z)` 當非貪婪擷取的結尾。JS 沒有 `\Z` 錨點，那就是字面的大寫 Z——所以每個 section
都在**標題之後第一個大寫 Z** 就被切斷。我在新表格裡寫了「**Zero each**」，`sync` 段落當場少了
一半，一支既有測試才翻紅。

無聲，而且最傷 `doesNotMatch` 那類斷言：切短的 slice 讓「這段不准出現 X」變成恆真。正確的
輸入結尾錨點是 `$(?![\s\S])`（`$` 在 `m` 旗標下是**行**尾）。已加一支 guard 測試，兩個方向都有：
含大寫 Z 的段落必須完整取到，遇到下一個標題必須停。
