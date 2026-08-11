# Doc Review Phasing — Implementation

What shipped, what it measures, and what the design said that the implementation did not do. Design
and rationale live in [`./2-tech-spec.md`](./2-tech-spec.md); this file records the built result.

## 1. What shipped

| Ticket | Shipped | Where |
|--------|---------|-------|
| r1 | `/review-spec` on the shared MCP doc-review path; `## Plan Review` state handling shipped with **activation deferred** — the `rules/auto-loop-project.md` slot stays commented pending the installer separation the tech spec records; `DOC_TOO_LONG` row corrected; `doc_iteration_history` counter | `hooks/post-tool-review-state.sh`, `rules/auto-loop.md` |
| r2 | Authority classification: `doc-metadata.js` roles, authority-aware source sets, `owesCodeAlignment()` | `scripts/lib/doc-metadata.js`, `scripts/config/doc-taxonomy.json` |
| r3 | Profile resolver, link checker, batched dispatch, Doc Sync contract, request freezing, prune-first, write-time budgets | below |

### 1.1 Two deterministic scripts, both advisory

| Script | Answers | Exit code |
|--------|---------|-----------|
| `scripts/check-doc-links.js` | Which repo-local **file links** do not resolve | Always 0 |
| `scripts/resolve-review-profile.js` | Which profile each changed file earns, and how the plan batches | 0 |

Neither is a gate, and that is the whole point: the feature promised to cut review cost **without
adding an enforcement point**. Their output is fed to the reviewer as facts already established, so
the LLM does not spend a pass rediscovering them.

`check-doc-links.js` skips what this checkout cannot answer for — external URLs, and templated
targets like `{FEATURE}`, `<feature-name>`, `${ROOT}` — and, since the § 1.8 narrowing, heading
fragments: `[x](#frag)` leaves the scan uncounted and `[x](./a.md#frag)` is checked as a link to
`a.md`. Containment is decided on the **real** path
(`realpathSync` on the nearest existing ancestor), so `../../../etc/passwd` and a symlink pointing
out of the repository both report `outside-repository` rather than `dead-link`. The distinction is
load-bearing: one is a typo, the other is an escape.

Destinations are found by **scanning, not by regex**. A regex has to fix a nesting depth and
CommonMark does not, so `[x](a(b(c)).md)` is one valid link a one-level pattern skips entirely. The
scanner also has to refuse what is *not* a link — a `](` inside a code span, one with no `[` opening
it, an escaped delimiter, an unbalanced destination, an unterminated or unseparated title — because
a finding raised on one reaches the reviewer as an established fact. Its unit is the **block**: a
run of lines bounded by a blank line or by any leaf-block opener (heading, list item, blockquote,
table row, thematic break, setext underline), with raw HTML blocks dropped and table cells masked
independently on unescaped `|`. Why it reports its own coverage rather than claiming completeness is
§ 1.7.

### 1.2 Five profiles, one-way escalation

| Profile | Reader covers | Code-alignment obligation |
|---------|---------------|---------------------------|
| `full-design` | Whole document + linked design context | Yes |
| `implementation-sync` | Changed hunks + enclosing `##` + preamble + link definitions | Yes |
| `living-sync` | Changed sections | Yes |
| `record-diff` | Changed hunks | **No** |
| `executable` | Changed sections + the file's own contract | Yes, against the instruction surface |

Escalation is **one-way and per file**. A file escalating raises its own questions and the batch's
shared dimensions; it never withdraws another file's `record-diff` exemption. Escalation to
`full-design` is forced by: an unparseable requested profile, an unknown classification, a
`sensitive-paths.json` hit or an unreadable sensitivity config, `--tier thorough` (Anchor
Register #3 — including a semantic security change on a generic path with zero path hits), and, for
files that are not new, changed sections outside a declared whitelist, or a **requested** shallow
profile that declared no whitelist at all.

Fail-closed everywhere: every "cannot tell" answer resolves to the deepest read, never the
cheapest. `sensitivityHit()` returns the string `'unknown'` — distinct from `null` for "no rule
matched" — precisely so an unreadable config cannot be mistaken for a clean bill.

**Every fact is derived, never accepted.** `inspect()` asks git for each file's status rather than
inferring it from whether a diff exists: an untracked file is read `whole` (every line is new, and
there is no diff to scope against), and a file missing from the working tree is read at `HEAD` via
`git show`, classified from that text, and reported `deleted: true` — not as a classification
failure, which is what "unreadable" looked like before. Newness is tested against **HEAD**
(`git ls-tree`), not the index: `git ls-files` reports a staged addition as tracked, so a file added
and staged in the same change would have been diffed against a HEAD that does not contain it.
Every "cannot tell" stays a `'unknown'`: a read error that is not `ENOENT` is not a deletion, and a
`git diff` that fails is `classification_unknown` rather than an empty diff — an empty diff reads as
"nothing changed", which is the cheapest possible answer to a question that was never answered.
`--plan` hydrates every entry the same way and overlays only the producer's `profile` and `sections`
— top-level keys are taken by allowlist (`tier`, `code_changed`, `files`), so a producer cannot
supply its own budget either. A producer that supplies its own role, byte count or changed-section
list has its whitelist certify itself, which is the one thing the whitelist exists to prevent.

Changed sections are mapped from **both** diff sides. A deletion at the top of a file reports
`@@ -1,2 +0,0 @@` — a new-side location of line 0, which is no line at all — so the new side alone
reads a real change as no change; and a wholly deleted section maps to whichever section survived at
that line, i.e. its neighbour. The old side answers both, and a removed `##` heading in the hunk body
is collected as a third signal. A side whose **count is 0** names a position, not a changed line: a
pure insertion `@@ -5,0 +6,4 @@` touches nothing on the old side, and marking the section at old
line 5 is how reading both sides could go wrong in the other direction. That falls out of the
marking range being inclusive — `start + count - 1` collapses to an empty range at count 0 — rather
than from a guard at the call site. The guard was written first and removed: it sat on an
unreachable branch, so no test could distinguish it from its own absence.

**The whitelist checks a claim, and only a claim.** The first implementation applied it to every
resolved profile, including the ones it derived itself. Running the finished resolver over this
feature's own 49-file change resolved **all 49 files to `full-design`** — the entire saving, gone,
with a green test suite behind it, because every case in that suite handed the resolver a
producer-declared profile and none exercised the CLI's bare `--files` path. It is now scoped as
`2-tech-spec.md` § 3.4 states: a declared whitelist is verified against the diff whether or not a
profile came with it; an *absent* whitelist escalates only a **requested** shallow profile. After the
fix the same 49 files resolve to 31 `executable`, 10 `record-diff`, 8 `implementation-sync`, zero
escalations. Pinned by four default-path cases in `test/scripts/resolve-review-profile.test.js`.

The `read` field follows the resolved profile (`whole` / `sections` / `hunks`), not the input. A file
that escalated and still reported `sections` would have been escalated on paper only — the reviewer
prompt binds on that column.

### 1.3 The batch budget

`scripts/config/doc-taxonomy.json` → `review_budget`: **12 files / 200,000 bytes**, whichever is hit
first, both boundaries **inclusive**. Within budget the plan is exactly one batch and one dispatch.
Over budget it splits by feature folder (`.md` outside `docs/features/**` in one final `(root)`
group), then chunks each group in path order.

Two properties the tests pin, because both were ways the split could quietly lie:

- The **union of batches equals the changed set** — nothing is dropped to fit.
- A single file over 200,000 bytes forms its own batch and is **reported** as over-budget, not
  skipped.

Sizing: the 98 non-record feature docs have a median of 310 lines, so 12 median files land near
190 KB — the two limits bind at roughly the same corpus, which is why either alone would have been
the wrong knob.

**Grouping before chunking costs dispatches on a wide change.** This feature's own 49-file change
plans as 12 batches, 8 of them single-file, because each feature folder opens its own group before
the budget is anywhere near hit. That is the shape the spec and r3's AC specify, and it buys a batch
whose files share context; the cost is visible here so a later change to the grouping rule has a
number to argue against.

### 1.4 The Doc Sync contract

| Document class | Doc Sync does | Reviewed as |
|----------------|---------------|-------------|
| Current authority — states what is true now (`2-tech-spec.md`, `3-architecture.md`, `README.md`) | Rewrite the sections the code changed | `implementation-sync` / `living-sync` |
| Record — states a point in time (`requests/*.md`, `review-log-*.md`, `adr-*.md`) | Append status and outcome; never rewrite | `record-diff` |

**146 of the 245 documents under `docs/features/` are request tickets.** Under the old contract
every one of them owed alignment with code it never described. That is the cost this table removes,
and it removes it by classification rather than by a new switch.

A closed request is frozen: `--update` changes nothing once Status is in `CLOSED_REQUEST_STATUS`
(`scripts/lib/request-status.js`). Resuming work on a closed ticket is a decision — a new ticket
referencing the old one — not an edit that makes history read as though the work never finished.

### 1.5 Prune first, then merge, then split

`rules/docs-numbering.md` § Size Limit previously named exactly one remedy for bloat, and it was the
only one that leaves the total unchanged. A corpus can only grow under a rule whose answer to "too
long" is "put it in more files": 241 feature docs added, 0 removed.

The ordered remedies are now prune (dead text) → merge (duplicated text) → split (what remains).
Live information is moved, never deleted; records are exempt from all three.

Write-time budgets, because enforcing length afterwards costs a review round that writing to budget
would have avoided:

| Document | Budget |
|----------|--------|
| Tech spec | ≤ 300 lines; 301–400 acceptable; over 400 must state a cohesion exception **in the document** |
| Request ticket | ~100 lines, AC ≤ 8, Background ≤ 10 lines; Progress cells overwritten, never appended |

This file is not within those budgets, and saying otherwise was the first defect a reviewer caught
in it. It stands at about 600 lines — past the `@rules/docs-numbering.md` action threshold —
**whole, with the reason stated as that rule requires**: §§ 1.7–1.9 are the round-by-round record of
how the scanner's container model earned each rule, each round arguing from the one before it, and a
split at any section boundary cuts that argument mid-flow. The remedy ladder was still applied —
what §§ 1–1.6 no longer restate is pruned into the tables above; what remains is one argument.

### 1.6 What the projection refuses

`isContextShape` checks types and presence and stops there, on purpose — it is the wrapper's
validator, and an empty corpus and a full one are equally valid answers to it. That leaves payloads
that are structurally perfect and semantically impossible, and `projectionIsConsistent`
(`scripts/detect-scope.js`) is the function that has to notice, because it projects exactly those
fields. The relations it enforces are the resolver's own construction, not a policy invented there:
`scripts/lib/feature-resolver.js` sets `docs_path` to exactly `docs/features/<key>` whenever a key
resolves, derives both `has_*` booleans from the matching `canonical_docs` entry being non-null, and
admits a key only if it matches `SLUG_RE`. Every constructor it has satisfies all of them, so
nothing legitimate is rejected.

| Refused payload | Why the obvious check misses it |
|-----------------|--------------------------------|
| `key: 'good'`, `docs_path: null` | Both fields are the right *type*; only the pairing is impossible |
| `docs_path` with no `key` | Names a directory no key resolved to, and `/recap-doc` reads `<docs_path>/2-tech-spec.md` on trust |
| `key: '../../outside'` with `docs_path: 'docs/features/../../outside'` | **Coherent** — deriving the path from the key passes. Derivation is only as constrained as the key, so the key itself is held to `SLUG_RE` |

The damage downstream is specific rather than abstract: `/recap-doc` clears its fail-closed gate on
`scan_error: false`, reads `has_tech_spec: true`, and opens `null/2-tech-spec.md` — which then looks
like an ordinary missing document rather than a report that should never have been trusted. Scope is
deliberately the projected subset: validating fields nobody there reads would make the function a
second, drifting copy of the resolver's post-conditions, which is the same failure as a second copy
of the traversal guard.

### 1.7 The re-scope: coverage reported, not assumed

The link checker took five review rounds, and rounds 2–5 were the same finding in different clothes:
a construct where the scanner and CommonMark disagree. Each round closed every divergence reported
and the next round found more, because there is no CommonMark parser here to defer to — this
repository ships zero dependencies — and every reviewer remedy amounted to "write one".

| Round | Findings in this file | Shape |
|-------|----------------------|-------|
| 2 | 1 of 6 | `](` matched as a byte pair |
| 3 | 3 of 5 | multi-line constructs, angle destinations, reference destinations |
| 4 | 3 of 3 | block boundaries, reference titles, setext anchors |
| 5 | 5 of 5 | leaf-block context, HTML block classes, title separation, setext context, slug fidelity |

Diagnosed `ARCHITECTURE` (`@rules/auto-loop.md` § Cap Diagnostic Protocol): the defect recurs, and
patching it is what reproduces it. The bounded adjustment was to **change what the tool promises**,
not to add another round of grammar.

**The load-bearing claim was never the parsing — it was that an empty `failures` array proves every
link resolves.** A scanner cannot make that claim. So the report now carries `unresolved`: the number
of link-shaped constructs it declined to classify, counting a `](` that survived masking without
producing a match, one inside a skipped HTML block, and a `[label]:` line that did not parse. The
prompt binds on the pair — `failures: []` settles the question only alongside `unresolved: 0`.

That inverts which errors are affordable. **Narrowing is now free**, because a construct the scanner
drops is reported as dropped rather than silently absent; the checker may decline anything it is
unsure of. **Inventing a finding is still forbidden**, because a finding reaches the reviewer as an
established fact. Every round-5 fix was chosen on exactly that line: the ones that invented findings
were fixed (GitHub's slug keeps both spaces around a dropped `+`, so three live links in
`docs/features/statusline-config/` were being reported dead; a title must be separated from its
destination; `- item` over `---` is a list and a break, not a heading), and the ones that only
narrowed became reported coverage.

### Round 7 — the re-scope made structural

Round 6 accepted the principle and round 7 showed it was not yet true of the code: *"the re-scope is
defensible only if every lossy or uncertain path reaches the counter. Currently it does not."* Five
paths did not. `stripFences` blanked text **before** anything was counted, so a candidate it removed
reached no exit at all; the proof rule reconstructed a code span's boundaries by walking the masked
text for spaces, and stopped at the first space the original already had; a GFM delimiter row was
accepted anywhere below the header instead of immediately after it; raw HTML was recognised only at
the head of an uncontainerized line; and fragment checking sat outside the accounting entirely,
inventing anchors from a code span and missing the ones a blockquote setext heading generates.

The answer was to stop editing the text and start **describing it**. Every lossy step now returns a
**range**, and there is one inventory and one decision:

| Step | Produces | Proven? |
|------|----------|---------|
| `codeBlockRegions` | fenced and indented code, as source ranges | yes — the line grammar settles both |
| `opaqueRanges` | HTML comments and code spans, left to right over the whole source | comment: yes. Span: only when it opens and closes on one line |
| `blocksOf` | the leaf blocks a span may not cross, and confirmed tables | — |
| `targetsOf` | one candidate inventory on raw block text, each candidate *classified*, *proven* or *unresolved* | — |
| `anchorsOf` | the anchor set **and** whether it is trustworthy | `uncertain` declines the fragment rather than deciding it |

Two rules fall out rather than being added. A comment is scanned over the **whole source**, because
it does not stop at a leaf block — `<!-- …` above a `>` quote and `-->` below it is one comment, and
scanning per block left the line between them exposed. A code span is the opposite: it *is* bounded
by its block, and by its cell in a confirmed table row.

Doing this surfaced a defect of its own, and the corpus is what caught it: `maskRanges` spread the
string with `[...text]`, which splits by **code point**, while every offset in the file is a UTF-16
index. One emoji above a table shifted the whole mask by a unit and left six live README links
unclassified. Length-preserving masking is load-bearing here, and `split('')` is what preserves it.

Measured on the corpus, 544 readable tracked `.md` files: **7 findings, `unresolved: 0`**, all of them
pre-existing dead links in files this change does not touch (`commands/*.md` and `test/commands/`
removed in the v3 migration, one missing `handoff-doc` reference).

There was an eighth, and it is worth recording because the new fence grammar is what found it:
`skills/architecture/references/template.md` wrapped its whole template in a three-backtick fence
containing three-backtick `mermaid` blocks, so CommonMark closes the wrapper at the first inner fence
and everything below it was live Markdown — including a `[requests/…](./requests/)` line that resolves
to nothing. The old scanner missed it by accident: it read ` ```mermaid ` as a *closer*, and the
parity error cancelled out. Widening the wrapper to four backticks fixed the document, so the count
above is 7 rather than 8. The three `statusline-config` false positives are gone,
and so are all five paths round 7 named.

### Round 8 — the container context, and a claim refuted

Round 7's structure held; round 8 found six places the source never *reached* it, five of them one
fact: **a construct carried by a container**. A fence behind `>` was read as prose and let its
contents out as live Markdown; a tab-indented line was measured at one column instead of four, so
indented code read as a paragraph; `<div>` was consumed even where a type-7 HTML block cannot
interrupt a paragraph; a reference definition indented inside a list item was neither resolved nor
counted; and an ordered marker was stripped unconditionally, inventing the anchor `#fake` from
`2. # Fake` under a paragraph and thereby *suppressing* the dead-fragment finding for the link to it.

The sixth is the one worth recording, because it refuted the round-7 claim directly rather than
extending it. `<!--` at column 0 looks like an HTML block opener, so a commented-out link took the
`block.skipped` shortcut and was counted unresolved — a range that was *computed and proven* and then
never consulted. "Every candidate reaches the decision" was true of the inventory and false of the
order the decision was made in. The range is now consulted first and the skipped state only decides
what to do when no range answers.

Two further paths my own probe found, both the same shape as the five: candidates inside an unproven
code region belonged to no block, so the block pass never saw them; and container-carried reference
definitions matched no inventory pattern. Both now reach the counter.

The ordered-marker rule is where measurement changed the design. Asked of every ordered marker, it
made **193 of 544** documents uncertain — an ordinary `1. 2. 3.` list is enough — which retires
fragment checking rather than qualifying it. Asked only where stripping the marker *reveals a
heading*, it makes **1 of 544** uncertain, and that one is a genuine two-line code span containing
`#`. Corpus after: **7 findings, `unresolved: 0`**, unchanged.

Eleven mutants over the round-8 sites, all caught — but only after four of them survived the first
run and each named a branch no test covered: a comment's terminator versus the generic block's blank
line, a definition-shaped line inside unread markup, a heading in the *first* item of an ordered
list, and an anchor written inside a code span. Four tests were added for exactly those.

### Round 9 — one principle, applied where it had not been

Round 9 verified all eight round-8 fixes present and working, and named five more P1 paths. Four are
the same sentence unfinished: **a container-carried construct is consumed only within its container,
and never proven.** Round 8 wrote that rule for the quoted fence and stopped there.

| Path | What it did instead |
|------|---------------------|
| Quoted fence closer | Accepted any quoted fence, so ` ``` ` closed a ```` block and exposed the link still inside it |
| Quoted fence extent | Ran past the blockquote through any non-blank line, masking a real heading below it |
| `> <div>` | Opened no HTML block, so the list under it was read as live Markdown |
| `[x]:missing.md` | Matched neither reference inventory, because the loose pattern required a separator CommonMark makes optional |

The fifth was different in kind and worth stating on its own: the ordered-marker rule tested whether
the previous line was blank **on the masked text**. A line reading `` `paragraph` `` masks to spaces,
read as blank, let `2. # Fake` interrupt nothing, and invented the anchor with the answer reported
certain. Paragraph interruption is a fact about the source, not about the rendering a later pass
masks into.

Two consequences fall out rather than being added. `anchorsOf` now takes uncertainty from **any**
unproven range, code or inline — the rule was always about a range's proof, not about which pass
produced it. And the two anchor extractions read different bodies: headings off a text with generic
HTML blocks masked (a `# Fake` inside `<div>` anchors nothing), explicit ids off one that keeps them
(`<a id="x">` inside a `<div>` is exactly how an anchor is declared).

One further hole, found while proving a mutant equivalent rather than by review: four columns under a
list marker is the item's continuation paragraph, not code, and proving it dropped a live candidate
out of the accounting entirely. It is now consumed unproven and counted. The equivalent mutant is
worth recording too — advancing a tab by a flat 4 instead of to the next multiple of 4 cannot change
an `is it ≥ 4 columns` test, because any tab in the leading run already lands at 4 or beyond. No test
was written for a difference that cannot be observed.

Twelve mutants over the round-9 sites: 11 caught, 1 equivalent. Corpus unchanged at 7 findings,
`unresolved: 0`, 1 uncertain document.

### Round 10 — the sweep, and the diagnosis that produced it

Round 10 was the fifth consecutive blocked round, so the round-10 checkpoint's diagnostic protocol
ran before any edit. Classification: **`ARCHITECTURE`**. The signals are unusual and worth stating,
because they are not the ones the class normally shows — every round's fixes were verified present
and working by the next round, none broke another, and the corpus result never moved. What recurred
was the *class*: the same structural defect on a construct not yet considered. The reviewer's own
root-cause sentence is the evidence: *the container abstraction represents only a count of blockquote
markers, cannot represent list containers, and removes deeper quote prefixes that should remain
content within an already-open leaf block.*

The bounded adjustment, declared before it was made: stop patching construct by construct; apply the
container rule to **every producer in one pass**, and fix the three defects that are not container
problems at all. Six edits, one file.

| Producer | Before | After |
|----------|--------|-------|
| Fence | Quoted only | `containerFence()` — quoted, list-carried, or both |
| Fence closer | Any quoted fence | `stripQuotes(line, depth)` — markers beyond the opener's depth are **content** |
| Raw HTML (`<pre>`, CDATA) | Terminator searched source-wide | Bounded by its container; unterminated inside one is not literal text |
| Generic HTML | Extent bounded, opener over-broad | Type 7 requires a **complete** tag alone on its line — `<x` is a paragraph |
| Anchor uncertainty | `#` and `id=` | The three constructs that make an anchor, setext underline included |
| Anchor extraction | One masked body | Two views differing in exactly one thing — code spans |

That last row is the one with reach outside synthetic inputs. GitHub slugs ``# Hello `world` `` to
`hello-world`; masking the span first produced `hello` and would report the live fragment dead. **355
headings in this repository contain a code span**, so it is a false positive waiting for the first
link to any of them. Heading text is now read from a body that keeps spans, explicit ids from one
that masks them — and inside a generic HTML block, where Markdown inline parsing is off, backticks
are literal so the `id` between them is real.

Nine mutants, all caught after two were rewritten: the first was not the defect it claimed to model,
and the second was near-equivalent — `stripQuotes` already drops three leading spaces and
`FENCE_CLOSE` allows three more, so an extra strip only changed behaviour past column seven. That
strip was **removed** rather than tested: it decided an ambiguous case this scanner has no content-
column model for, and the direction it decided was the unsafe one.

The P2 (`lastContent` treating any indented paragraph as list context, declining top-level indented
code) is logged `[NIT_DEFERRED]` and not fixed — sub-threshold, and it fails visibly rather than
silently.

### Round 11 — the adjustment failed, and that is the result

Round 11 returned six P1s and answered the question the round-10 adjustment was declared against:
*"The `ARCHITECTURE` diagnosis was correct, but the bounded adjustment was insufficient. Four
blocking findings are the same class again."* HTML opener recognition, comment extent, table
formation and setext extraction each consume container-sensitive syntax without the shared model;
`stripQuotes` centralised exact blockquote removal but list content columns still exist only as a
special case inside `containerFence`.

The diagnosis budget is one per change and it was spent at round 10. The prescribed remedy — a
container decomposition returning quote depth, list content indentation and bare content for every
producer — is a rewrite of the scanner's core, and the protocol's own instruction for that case is to
exit rather than adjust. **The loop stops here and the decision goes to the owner.**

What the record should carry, because it is the input to that decision:

| Fact | Value |
|------|-------|
| Corpus result | 7 findings, all genuine dead links; `unresolved: 0`; 1 uncertain document |
| Dead **fragments** found in 544 documents | **0** — the anchor side has never contributed a finding |
| Round-11 P1s reachable on this corpus | **0** of 6 — none produces a wrong answer on any tracked file |
| Syntactic precursors present | 11 padded code-span headings, 4 quoted delimiter rows; no link targets either |
| Rounds spent | 11, on an input that is advisory and always exits 0 |

Four of the six P1s are anchor-side. The anchor and fragment machinery is where the recurring class
lives, and on this corpus it finds nothing — which is the case for narrowing the scanner's claim to
link resolution rather than continuing to defend both.

### 1.8 The narrowing — the owner's answer to round 11

The decision came back on 2026-08-10: **narrow the scanner to file-link resolution**. Fragments are
out of scope, not deferred — `[x](#frag)` leaves the scan the way an external URL does, and
`[x](./a.md#frag)` is checked as a link to `a.md` alone.

What that removed, and what it cost:

| | |
|---|---|
| Deleted | `anchorsOf`, `slug`, `HTML_ANCHOR`, `ANCHOR_BEARING`, `SETEXT_UNDERLINE`, and the now-unread `raw`/`closed` block state that only `anchorsOf` consumed |
| Scanner | 1090 → 908 lines (1109 after § 1.9's container fixes) |
| Tests | 97 → 74 (27 anchor cases removed, 6 link-side replacements added, 2 anchor-named cases dropped once the narrowing left them asserting nothing); § 1.9 then takes the file to 101 |
| Round-11 P1s eliminated | 4 of 6 — every anchor-side finding, and with them the recurring class |
| Corpus result | 7 genuine dead links, `unresolved: 0` — **identical to before the narrowing**. Measured over the 545 tracked `.md` paths, one of which is the file r2 deleted and so reports `unreadable` |

The last row is the whole argument. Eleven rounds of container modelling defended a capability that
found nothing on any tracked document, and removing it changed no answer the checker gives.

A dead `#fragment` is now nobody's finding deterministically — the reviewer may still raise one, and
`skills/doc-review/SKILL.md` § Step 2 says so, so the narrowing does not read as coverage the prompt
claims to have.

### 1.9 Round 12 — the corpus is not the contract

The first draft of § 1.8 called the surviving link-side P1s "unreachable on this corpus" and left
them unfixed on that ground. Round 12 refused the reasoning, and it was right to: **the checker's
input is changed and newly created documents, so today's corpus bounds nothing** — absence from 545
files is a fact about the past, not a limit on the next commit. Its four P1s each came with a
concrete input producing a decisive wrong answer, and all four are fixed, each with a
paired-direction regression test:

| Finding | Wrong answer it produced | Fix |
|---------|--------------------------|-----|
| List-carried HTML block unrecognised | `- <div>` + an indented link under it → an **invented** dead-link finding | `listedHtmlOpener` — the block is consumed *skipped*, its candidates reach `unresolved` |
| Comment range ignored its container | `> <!--` swallowed the unquoted live link below the quote, `unresolved: 0` | `containerEnd` bounds a comment at the quote that opened it |
| Quoted table never confirmed | Backticks in two cells paired into a span that erased the link between them | `blocksOf` treats the quote marker as a container: depth change ends the block, the delimiter row is read through `stripQuotes` |
| Template filter ran before the fragment split | `[x](missing.md#{SECTION})` skipped whole — a concrete file unresolved silently | `scanFile` splits the fragment first, then filters the **file part** |

The table fix exposed a follow-on this round's mutation harness caught before review did: a line
where the quote depth changes with no blank line between is a **lazy continuation**, and deciding it
in either direction invents an answer — the old code let the quote's comment/span swallow it, the
first fix reported its link as live. It is now consumed unread (`startLazy`), so its candidates are
declined, with both directions pinned by the same test. Type-7 interruption kept its rule through the
rewrite (a complete tag alone on its line still cannot interrupt a paragraph) and gained the test it
had lost.

Also from round 12: the fragment-era `comment:` range field, `inlineOpaque`'s offset parameter, and
the ordered-list-heading test (vacuous once no anchor is read) are gone; the prompt's "every link
resolves" is now "every in-scope file target resolves".

Round 13 verified all four fixes and their controls, then found the same class once more — **HTML
comments crossing two container boundaries the quote fix did not reach** — and one deferred P2:

| Finding | Wrong answer it produced | Fix |
|---------|--------------------------|-----|
| Comment opened on a list-carried line | `- <!--` through an unmarked `-->` swallowed the *sibling* item's live link, `unresolved: 0` | `listCarried` — a multi-line comment opened on a marker-carried or indented line is consumed **unproven**, so candidates on both readings are declined |
| Comment crossing a confirmed table's cells | The unescaped pipe ends the cell, so the comment cannot own the next cell's link — yet it did | The span rule extended to comments: one that does not close inside its cell is literal text |
| (P2, fixed on the spot) every depth change marked lazy | An ATX heading after a quote is decisively new, but its settled links were declined | Lazy needs both: **shallower** (laziness omits markers, so a deeper line is a new quote) and not a leaf opener |

The mutation harness then caught two of its own: no test covered the indented-content variant of
`listCarried`, and none pinned the deep-to-shallow ambiguity (`>> \`` may lazily continue on a`>`
line) that separates the bare-line test from the raw-line one. Both gained paired tests.

Round 14 verified round 13 and found the class's last visible member: an **inline** comment —
one with content before it on its line — opened inside a paragraph and reached past the heading
that interrupts it, because the terminator search was source-wide. The same shape bypassed
`listCarried` through a lazy list continuation (`- text\ncontinued <!--` — no marker, no
indentation on the opener line). The fix gives inline openers an owner: bounded by their leaf
block, and unclosed there they are literal text — the paragraph rule CommonMark already applies.
Codex's second finding, that `listCarried`'s indentation test over-declines a settled top-level
`<!--` block, is logged sub-threshold: fixing it needs the list model this scanner deliberately
does not have.

Round 15 found the class's closing member inside the round-14 fix itself: the inline bound was
compared **after** truncation, so a container edge or EOF landing exactly on the block end
masqueraded as a terminator and proved an unclosed comment. The fix keeps the real `-->` offset
apart from every effective bound, and decides an out-of-block terminator by what stands **directly
at the block's edge**: a blank line or decisive block there ends the paragraph outright (opener
literal, its own candidates parsed); a skipped block or unproven code region there is a lazy line
that may close the comment over the candidates, so the extent up to the block end is consumed
unproven. The declined range stops at its own block — beyond it, blocks answer for themselves. The
harness then drove out three more corner tests (a decisive block between the edge and a far
terminator, a `2.` marker that cannot interrupt and so opens no fence, a table row opening with an
unterminated comment) before all ten mutants died.

Round 16 verified round 15's edge-decision and found three final-detail P1s, none of them a new
class:

| Finding | Wrong answer it produced | Fix |
|---------|--------------------------|-----|
| Ordered marker ≠ 1 read as decisive at the edge | `2. item` cannot interrupt a paragraph (CommonMark), so treating it as a paragraph end proved a comment over a lazy line | `afterOrdered` — a same-depth ordered marker whose number is not 1 makes the edge ambiguous; the comment's extent is consumed unproven |
| CRLF documents measured on two texts | `\r` bytes shifted offsets between passes that read raw and normalized text — the link fell off its own masked slice and drowned as `unresolved` | `normalizeEol` at all four per-source entries (`codeBlockRegions`, `opaqueRanges`, `blocksOf`, `targetsOf`); findings carry line numbers, which normalization cannot shift |
| Comment body grammar unchecked | `<!-- a -- b -->` is not a comment per cmark-gfm, so proving it swallowed live text | Inline proven path validates the body: not starting `>`/`->`, no `--`, not ending `-` |

The round-17 mutation harness (7 mutants over these fixes) left two survivors, both genuine gaps:
dropping the depth comparison in `afterOrdered` (a **quoted** `> 2.` is a quote interrupt first —
decisive, whatever its number) and dropping the `targetsOf` normalization (splitting the coordinate
system, which the existing CRLF fixtures happened to survive). Each gained a killing test; the rerun
kills 7/7.

Round 17 verified all three round-16 fixes on their supplied cases, then found each one's edge:

| Finding | Wrong answer it produced | Fix |
|---------|--------------------------|-----|
| Lone CR not a line ending | A CR-only document fused into one line — the table was never confirmed, the cross-cell span erased its live link, `unresolved: 0` | `normalizeEol` rewrites `\r\n?`, both endings CommonMark recognises |
| `inlineMatches` split its coordinates | The inner passes normalize their own copy; applying those offsets to a CRLF original sheared the mask off the code span, and the code target parsed as a live link — an **invented** target | Normalize once at `inlineMatches` entry; range production, masking and parsing read one string |
| Ordered-marker check lost its indentation | `>   2.` (marker indented 2 content spaces) failed the column-zero regex, so the ambiguous edge was proven decisive — a definitive `dead-link` where the comment may own the candidate | `^ {0,3}` restored, quote-depth check kept |

One of round 17's three P2s — interruption compared the marker's spelling (`m[1] !== '1'`) rather
than its number, over-declining `01.` — was fixed on the spot as the one-line fix in an open file
that `auto-loop.md` § Sub-Threshold Findings allows, with `01.`/`02.` controls. The other two
(distinguishing tests for the three independent comment-body clauses; direct CRLF control of each
exported lower-level pass) are logged `[NIT_DEFERRED]` and stand. The round-18 harness (6 mutants
over these fixes, including reverting each normalization and the spelling compare) kills 6/6.

Round 18 confirmed all four fixes and found the P1 the CRLF work had created: normalization gave
the module two coordinate systems, and the **exported** surface leaked the wrong one. `inlineMatches`
classified correctly but returned `offset`/`opener` indexing the normalized copy — on a CRLF block
the caller's slice at the reported offset landed inside the code span. The same ambiguity sat in the
exported range producers, whose composition from outside (`maskRanges(raw, opaqueRanges(raw, …))`)
would misapply every range. The fix restores one contract — positions are locations on the string
the caller passed: `rawOffsetMapper` walks the dropped `\r\n` pairs once and remaps what
`inlineMatches` returns (slice-back and opener controls pinned in the tests), and `blocksOf` /
`opaqueRanges` / `codeBlockRegions` leave the exports (guard test in both directions) — internal
composition already reads one normalized text, and `targetsOf` speaks in line numbers, which
normalization cannot shift. The round-19 harness kills 5 of 6 mutants; the survivor (`<` → `<=` in
the mapper's pair count) is **equivalent**, not a gap: the boundary case fires only for an offset
pointing exactly at a dropped newline, and every position `inlineMatches` returns — a destination
start, a `]` — is a content character, never a line ending.

After rounds 12–18: scanner 1109 lines, 101 tests, and the corpus answer is **still** 7 findings /
`unresolved: 0` — the adversarial inputs live in the test suite, where they belong.

## 2. Measurement — and what could not be measured

r1's `doc_iteration_history` is **cumulative and not cleared at SessionStart**, so it is a genuine
cross-session baseline. Reading at the point r3's first edit landed:

| Field | Value |
|-------|-------|
| `dispatches` | 18 |
| `verdicts` | 2 (1 pass, 1 block) |
| `no_verdict` | 0 |
| `legacy` | 0 |

**Dispatch-to-verdict loss: 16 of 18 dispatches produced no verdict** — 89%. That is the single
number this feature exists to move, and it was measurable.

The other three metrics r3's AC asked for were **not**:

| Metric | Why not |
|--------|---------|
| Dispatches per cycle | The counter is an aggregate. It holds no per-cycle records, so 18 dispatches cannot be divided into cycles |
| Bytes per dispatch | Never recorded — the counter increments a field, it does not measure the prompt |
| Profile mix | Profiles did not exist before this ticket; there is nothing to compare against |

The AC also asked for a baseline "covering at least 10 completed doc cycles". A completed doc cycle
is not a thing this counter can identify: it counts dispatches and verdicts, and 2 verdicts is the
closest thing to a cycle count it holds. **The AC is written against data that does not exist.**
Reporting the aggregate honestly is the correct outcome; deriving per-cycle figures from it would be
invention, and this file would then be the record of that invention.

What a later measurement can compare against, from the same counter: dispatches and the
verdict/dispatch ratio, before and after. Both are in the table above.

The owner resolved this on 2026-08-10 by rewriting the AC rather than the counter: r3's AC 8 now
asks for exactly the two figures above, and per-cycle measurement is deferred with the § 5 machinery
that would have to record it. An AC no shipped instrument can answer is a permanently open gate, not
a measurement — which is the failure mode the rewrite removes.

## 3. Tests

| Suite | Cases | Covers |
|-------|-------|--------|
| `test/scripts/check-doc-links.test.js` | 101 | **Resolution**: dead link, live link, external and templated skips, `..` traversal, symlink escape and non-escape, unreadable document, malformed percent-escape, advisory exit 0. **Fragments, since § 1.8**: a fragment naming no file leaves uncounted; a fragment on a path is checked as a link to that path; a target that exists but will not read is a resolved link, not a coverage loss. **Inline grammar**: an unopened `](`, a link inside a code span, escaped delimiters in both directions, the whole escapable punctuation range, unterminated and unseparated titles, angle destinations, unbalanced destinations, nested-parenthesis destinations, two dots in a filename, reference definitions with and without a closed title, a paragraph that only looks like one. **Block boundaries**: multi-line label, code span across a line break, blank-line block end, list item, heading, table row, table cell, escaped pipe, raw HTML block and its blank-line end, incomplete tag as a paragraph. **Coverage contract** — the reason `unresolved` exists: a declined construct and a skipped HTML block each raise it, a fully resolved document reports 0, a span closing on another line is unresolved in both scan directions against a same-line control, and a link inside a multi-line comment is unresolved rather than dead. **Container model** (rounds 7–11, each case with its own control): fences behind a quote marker, carried by a list item, and by both; a closer matching the marker it claims and closing at its content column; a deeper quote marker inside an open fence; an over-stripped marker not reading as blank; a backtick in an info string; a closing fence with trailing text; indented code against a lazy continuation and against a list item's continuation paragraph; columns not characters, so a space and a tab reach four; comments at column zero, mid-line and behind a quote marker; type-6 blocks swallowing a list; `> <div>`; a delimiter row two lines down; ordered markers that cannot interrupt a paragraph; reference definitions in containers and in unread blocks; raw and quoted blocks ending with their container; `maskRanges` blanking exactly its range after an astral character; and round 12's container set (§ 1.9), each with its control: a list-carried HTML block declined against a plain list item's dead link, a quoted comment ending at its quote against an uncontained one, a quoted table confirmed against its unquoted twin, a templated fragment on a concrete file still resolving the file, a lazy continuation declined against a blank-line-separated control, type-7 non-interruption against type-6 interruption, and round 13's comment-container set: a list-carried comment (marker and indented forms) declined against a column-zero control, a cross-cell comment read as literal against an in-cell one, a leaf opener ending laziness, and deeper-is-new against shallower-stays-declined; and rounds 14–15's inline-comment ownership: a mid-line opener cannot cross the block that owns it (heading-interrupt and lazy-list forms) against an in-block-closing control, a bound never masquerading as a terminator (lazy-terminator declined, EOF and blank-line literal), edge-decisiveness (heading at the edge, far decisive block, non-interrupting `2.` marker), and an unterminated table-start comment; and rounds 16–18's closing set: the ordered edge (`2.`/`02.` and a quoted indented `2.` declined, against `1.`/`01.` and a deeper quoted `> 2.` decisive), CRLF and lone-CR normalization (plain and quoted tables, a CR-only table, a plain CRLF link), comment-body grammar (`--` invalid against a valid control), and the exported location contract (slice-back and opener controls on two CRLF fixtures, range producers asserted off the public surface) |
| `test/scripts/resolve-review-profile.test.js` | 43 | Whitelist in/out/undeclared, the bare-`--files` default path, new-file read-whole, sensitivity hit and exclude, unknown config, tier fail-closed table, semantic security with zero path hits, per-file profiles in one batch, byte and file boundaries at 200000/200001 and 12/13, 25-file chunking with union check, group ordering, over-sized single file reported, `changedSectionsFromDiff` including a zero-length hunk side, shipped-taxonomy parity, and a CLI block over a throwaway git repository (untracked, staged addition, deleted, `--plan` with false producer facts and a false budget, whole-section and top-of-file deletions, malformed `exclude`, an EISDIR read failure, a failing git) |
| `test/skills/doc-review.test.js` | 17 | Instruction/permission pairing (with negative control) and the one deliberate exception — `node` instructed but not granted, asserted together with the SKILL sentence that explains why, so the gap cannot be "fixed" back in as an oversight — scripts exist, deterministic checks ordered before dispatch, plan-not-file dispatch unit, profile table matches the resolver's `PROFILES`, `record-diff` exemption documented, `[NIT_DEFERRED]` shape, and a guard rejecting any unqualified "empty `failures` settles links" instruction |

The profile table test compares the skill's table against `PROFILES` exported by the resolver, so a
profile the resolver can emit but the skill does not document fails the suite. Its parser is pinned
by a decoy case — without one, the assertion would pass on any prose mentioning the names.

## 4. Deviations from the spec

| Spec said | Built | Why |
|-----------|-------|-----|
| § 4 Step 6: compare after ~20 completed doc cycles | Reported the aggregate at 18 dispatches / 2 verdicts | The counter cannot identify a cycle; see § 2 |
| r3 AC: baseline covering ≥ 10 completed doc cycles | AC rewritten against `dispatches` and the verdict/dispatch ratio | Same cause. Closed on the owner's decision, 2026-08-10 — the instrument, not the report, is what was missing, and per-cycle measurement is deferred with § 5 |
| `skills/doc-review/SKILL.md` runs its own deterministic steps | `Bash(node:*)` **not** granted; Steps 2–3 ask at run time | The widening was flagged for the owner and declined, 2026-08-10: `allowed-tools` is pre-approval, not a capability boundary, so the steps still run — what the omission removes is a silent grant covering every `node` invocation, including ones this workflow never names |

## 5. Open

- (closed in round 12) The two link-side P1s round 11 raised were fixed with the rest of § 1.9 —
  the "unreachable on this corpus" ground was refuted, not defended.
- `docs/features/doc-review-phasing/2-tech-spec.md` § 5 machinery stays deferred: its re-entry
  criterion is a measurement showing recall failure, and § 2 shows the measurement cannot yet
  distinguish recall failure from anything else.
