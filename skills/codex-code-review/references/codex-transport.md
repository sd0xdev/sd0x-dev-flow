# Codex Transport (canonical)

**This file is the authority on how a Codex dispatch is carried**: the operational command lines,
the scratch-file lifecycle, and the completion state machine as a whole — the full mapping of every
exit code and non-exit outcome. On any disagreement, this file wins.

Three earlier drafts of this paragraph each claimed something stronger and each was false, so the
claim is now split by what actually holds it up:

| | What is true of it |
|---|---|
| **Mechanically enforced** | Exactly one property, and it is now closed: no operational `codex exec` invocation appears in any file under `skills/`, `agents/` or `rules/` except this one. Guard 1 in `test/rules/codex-transport-guards.test.js` fails if one does. It carried a whole-file exemption for `agents/codex-implementer.md` until work item 4 made that agent an explicit `/codex-implement` router; `GUARD1_PENDING` is now empty and equality-checked, so a new exemption cannot be added silently. That, and only that, is what a test guarantees about exclusivity |
| **Required elsewhere, by another guard** | A fallback-policy site must *name* the trigger — `codex_fail`, adapter **exit 1** on `start`/`resume` — and Guard 5 fails it otherwise. Guard 5's inventory holds seven such sites; the ones a reader meets first are `rules/auto-loop.md` § Review Dispatch, `SKILL.md` § Step 3.5 and `review-common.md` § Degradation Matrix. **Only the trigger identity is pinned.** Each also carries a short list of outcomes that do *not* reach a fallback; those lists are subordinate summaries and nothing checks them, so read them against this file, never instead of it |
| **Convention, unchecked** | Everything else — that call sites cite rather than restate the file lifecycle. `plan-review` is the standing exception (§ Files): it names *that* the prompt is written by heredoc rather than by Write, because its own workflow turns on that, and restates no other lifecycle guarantee |

The reason for any of it is drift: the same predicate restated in thirty call sites loses a copy per
review round (`docs/features/codex-exec-transport/2-tech-spec.md` § 3.4).

The prompt contract is elsewhere and unchanged: `@rules/codex-invocation.md` decides what a prompt
may contain (metadata only on a first dispatch, no fed conclusions, no cumulative attack lists).
This file decides only *how* the prompt is carried.

## Locator

The adapter is `scripts/codex-exec.js`, installed as a core script. Resolve it in this order and
stop at the first hit:

| # | Path | Meaning |
|---|------|---------|
| 1 | `.claude/scripts/codex-exec.js` | Installed copy — the normal path in a consuming project |
| 2 | the plugin's own copy: `~/.claude/plugins/**/sd0x-dev-flow/**/scripts/codex-exec.js`, then `${REPO_ROOT}/node_modules/sd0x-dev-flow/scripts/codex-exec.js`, then plugin-relative `@scripts/codex-exec.js`. **The second `**` is not decoration** — a marketplace cache installs each version separately as `cache/<marketplace>/<plugin>/<version>/scripts/…`, so the one-sided form `plugins/**/sd0x-dev-flow/scripts/…` that `precommit-fast` § Step 1 uses matches the `marketplaces/…/plugins/<plugin>/` and `data/<plugin>/` layouts and misses the versioned one entirely (measured with `fs.globSync`: two of the three layouts match, the versioned path returns `[]`). If it matches **more than one** installed version, that is an ambiguity this cascade cannot resolve — take step 4 and tell the operator to run `/sd0x-dev-flow:install-scripts codex-exec.js`, rather than guessing which version is current | Copy it to `.claude/scripts/` **only when the destination is missing**, then use it. Same auto-install shape as `skills/precommit-fast/SKILL.md` § Step 1 "NOT found → Auto-install attempt", including its skip-on-conflict rule |
| 3 | `scripts/codex-exec.js` | This repository only, developing the plugin itself |
| 4 | — | `setup-required`: surface it to the operator. **Not** `codex_fail`, and no fallback reviewer is dispatched |

Every invocation passes `--protocol 1`. A `[CODEX_EXEC_CONFIG] code=protocol_mismatch` answer means
the installed adapter is incompatible with this contract — older or newer, since the adapter only
compares the supplied protocol against its own constant: tell the operator to run
`/sd0x-dev-flow:install-scripts codex-exec.js --force` and stop. **Never overwrite a conflicting
installed adapter automatically** — a mismatch proves incompatibility, not that the file is an
unmodified plugin artifact (`precommit-fast`'s auto-installer skips on conflict for the same reason).

Locator resolution and any auto-install happen **before** the scope baseline is frozen, so an
install cannot move the digest under a review that has already started.

## Files

One `alloc` per dispatch, and the whole lifecycle repeats for every round — a `resume` gets a
**fresh** directory, never the previous one (preflight refuses an existing report):

```
alloc → Write the prompt → start | resume → Read the report → cleanup
```

`alloc` returns a `0700` directory under the OS temp dir with the four paths inside it — `prompt.md`,
`report.md`, and the two § Progress files `progress.json` / `events.jsonl`; the prompt is
written with the **Write tool** (never a shell heredoc — `skills/smart-commit/SKILL.md` § Step 5c,
execute-mode branch, is the precedent).

**One caller is exempt, structurally**: `plan-review` runs *before* `ExitPlanMode`, and plan mode
blocks the Write tool until the plan is approved — so "use Write" is not advice it can take, and a
contract stating it would be unexecutable rather than strict. It materializes `prompt.md` through the
randomized-delimiter heredoc its own § Redaction already specifies and already had reviewed (a fresh
≥8-hex `PLAN_EOF_<suffix>` per dispatch), under the `Bash(bash:*)` grant it already holds. Nothing
about the transport moves: no new grant is issued, the scratch lifecycle stays the adapter's, and
preflight still `lstat`s the file and chmods it `0600`, so the caller never sets a mode. The general
rule stands for every other caller, and the reason it can: they have a Write tool to use, and no
delimiter discipline of their own.

The recipe lives **here**, not in the skill: INV-001 puts every operational command line in this
document, and a call site spelling one is what Guard 1 exists to catch (measured — it went red the
moment the recipe was drafted into `plan-review/SKILL.md`).

```bash
# 1. Alloc as usual, then read `promptFile` out of the JSON and carry it in the conversation.
node <locator> --protocol 1 alloc

# 2. Write the rendered prompt there. The heredoc belongs to the OUTER shell and `bash -c` only
#    consumes stdin; the path travels as an argument ($0 is the placeholder `_`). The prompt body
#    therefore never sits inside a quoted string, which is the whole point — see below.
bash -c 'cat > "$1"' _ '<promptFile>' <<'PLAN_EOF_<fresh-suffix>'
<the rendered prompt>
PLAN_EOF_<fresh-suffix>
```

**Never nest the heredoc inside the `bash -c` argument.** Writing
`bash -c 'cat > "…" <<'\''DELIM'\'' … DELIM'` puts the rendered prompt inside a single-quoted
string, so the first ASCII apostrophe in the body closes that quote. Measured on bash 3.2.57 with
the stock `plan-review/references/codex-prompt-plan.md`, which contains `Claude's` and needs no
hostile input: the file was written **truncated** at the apostrophe (`Line with Claudes`), and the
words after it were handed to the shell as commands (`PLAN_EOF_…: command not found`) — prompt text
executing as shell, which is the exact risk `plan-review` § Redaction's randomized delimiter exists
to close. The shape above is immune because nothing quotes the body: verified byte-identical output
for a payload carrying an apostrophe, `$VAR`, a backtick and double quotes.

`<locator>` is the cascade at § Locator, never a hardcoded path — `.claude/scripts/codex-exec.js`
does not exist in this development checkout, where the same cascade resolves `scripts/codex-exec.js`.
The delimiter is collision-checked against the **fully rendered prompt body**, not the plan text
alone: the template's own sections travel in the same heredoc, so a suffix absent from the plan can
still occur in what is written. No prompt or report artifact is written inside the repository, so review
artifacts never move the tree digest. (The locator may install the adapter itself at
`.claude/scripts/codex-exec.js` — that is a one-time setup write, not a review artifact.) `cleanup <dir>` runs after that dispatch's report has been
read — for a background call, only after its completion notification has been consumed.

**Confidentiality is layered, and the layers are worth stating exactly** — an earlier draft promised
an unconditional file mode that no adapter at this privilege level can deliver:

| Layer | What it guarantees | Limit |
|-------|--------------------|-------|
| The `0700` directory | Another user cannot traverse into it, whatever the files inside are set to. This is the boundary that actually holds | The adapter creates it; it does not police it afterwards |
| Atomic creation of the **report** | The adapter creates `report.md` itself with `O_CREAT\|O_EXCL` — refusing any squatter at the path, a dangling symlink included — then `fchmod`s that descriptor to exactly `0600`. The `fchmod` is not decoration: a create-mode argument is masked by the ambient umask (measured: `umask 277` yields `0400`), which the success check below would then reject | Protects the inode it created, not the pathname forever |
| Preflight on the **prompt** | The caller writes `prompt.md` with the Write tool — except `plan-review`, whose exemption is stated above; preflight then requires a regular, readable, non-empty file at that exact path inside the alloc dir (`lstat`, so a symlink is refused) and chmods it `0600` | It validates a file it did not create, so it cannot claim the report's creation-time guarantee |
| The success check | A run that would report success re-reads the mode and fails instead if it is not `0600` | Refuses to *call* a widened report a success; it cannot un-widen one |

What is deliberately **not** claimed: an absolute guarantee against the child itself. `codex` runs as
the same user and could chmod or replace the file; defending against that needs privilege or
ownership isolation, not a mode bit, and `codex` is the tool we chose to run, not an adversary. What
was tried and removed: a process-wide `umask(077)` before spawn — it did constrain a replacement
report, but the child inherits it for **everything**, so under `--class implement` every workspace
file Codex generated would have come out `0600` and every directory `0700` instead of the caller's
own defaults. A report-scoped control may not reach outside the report.

No dedicated `mktemp`, `chmod` or `rm` command grant is needed or added, and the choreography
documented here invokes none of those utilities: `alloc` and `cleanup` are the adapter's. That is a
statement about what this contract requires, not a capability bound — a caller holding
`Bash(bash:*)` could run any of them, as § Permission says of every broad grant.

## Alloc

```bash
node <locator> --protocol 1 alloc
```

Prints one line: `{"protocol":1,"dir":…,"promptFile":…,"reportFile":…,"progressFile":…,"eventsFile":…}` —
the last two are the § Progress files, named here so a caller never derives a path by hand.

**Before it creates anything, `alloc` reaps its own stale siblings** (2026-09-05): every
`codex-exec-*` entry under the temp root that is this user's `0700` directory — `lstat`, so a
symlink is never followed — whose directory mtime is more than **24 h** old, **and whose owner
is not alive**, is removed, best-effort. The mtime is a heartbeat, and a heartbeat can stop while
its owner lives — a machine asleep for a day, a snapshot that failed — so the sweep also asks for
positive liveness: the adapter writes its own `pid` into `progress.json` at preflight (a guaranteed
write that precedes the child, not the best-effort heartbeat; every later snapshot carries it too),
and the sweep reads the **first 96 bytes** of that one file — the only thing it reads inside a
candidate, opened `O_NONBLOCK|O_NOFOLLOW` and judged by `fstat` on the descriptor rather than by
its name, so a FIFO swapped in at that path cannot park the open and hang the `alloc` (a review
measured the blocking form doing exactly that) — matching the fixed prefix every adapter snapshot begins with,
`{"protocol":1,"status":"…","pid":N`, anchored at byte 0 (a snapshot can be large, since the
child's command text is unbounded, so a whole-file parse under a size cap would call a live owner
dead exactly when its snapshot grew; and the anchor is what keeps a `pid` nested deeper in the
document from counting), and skips any directory whose owner process still exists (`kill(pid, 0)`;
`EPERM` counts as alive). A reused pid keeps a dead directory a little longer, never the reverse. **Never by a name after the identity check**: the candidate
is first renamed to a random `.reap-*` quarantine name in the same root, re-`lstat`ed, and deleted
only if `{dev, ino}` still match what was validated — a directory a same-user neighbour swapped
under the checked name in that window is renamed back, not erased. The deletion itself is bound
to that inode rather than to the quarantine name: the adapter `chdir`s into the directory, compares
`stat('.')` to the validated identity, and removes each entry by relative name (which the kernel
resolves from its cwd reference, so renaming the quarantine name away cannot redirect them — Node
has no `unlinkat`) under the same ordering rule one level down — rename to a random inner
`.reap-*` name, re-`lstat`, compare `{dev, ino}`, unlink by that random name, never a directory
(`scripts/skills/necessity-audit/cleanup.js` `unlinkVerified` is the precedent, and its limit is
this one's: the final unlink still resolves a name, Node having no unlink-by-descriptor, so what
guards the last microseconds is that the name is unpredictable, not that the call is atomic — a
known limit the adapter's tests state rather than hide) — and closes with a
**non-recursive** `rmdir`, which refuses anything that still has contents. So a substitute swapped
in at the quarantine name — before or after the pin — keeps its files and stays quarantined, a file
swapped under an entry name is parked under its inner quarantine name rather than unlinked, a stale
directory holding a nested directory stays quarantined with it, and an entry whose re-check,
restore, `cwd`, listing or unlink failed likewise stays — the evidence trail rather than debris
(`docs/features/workflow-orchestration/4-implementation.md` § 1.1 is the pattern: relocation is
recoverable, deletion is not, and `rmSync(name, {recursive})` after an identity check is exactly
what it rejects). Every one of those failures is inside the sweep's own boundary, `process.cwd()`
included: none reaches `alloc`. The mtime is the right clock because a live dispatch
renames `progress.json` into its directory on every event and every tick (§ Progress), so a
running dispatch — however long — is never a day stale; only a directory nobody `cleanup`ed can be.
2180 such directories had accumulated in 29 hours before this clause (measured): a lost completion
notification, a killed session, or a compaction that dropped the alloc record each leaves one, and
no caller-side discipline reaches a caller that is gone. A sweep that fails leaves `alloc`
untouched — it is bookkeeping around the next dispatch, never a condition on it — and a directory
younger than a day is never touched, so an unread report waits out the day for its reader.

## Start

```bash
node <locator> --protocol 1 start --class review \
  --prompt-file <dir>/prompt.md --report-file <dir>/report.md [--profile <name>]
```

Use `start` for a first dispatch and for a thread rotation. `--class implement` exists for exactly
one caller — `skills/codex-implement/` — and gives Codex `workspace-write`; every other skill,
review or conversation, passes `--class review` (`read-only`). Guard 3 pins that ownership.

Both classes pin `approval_policy="never"`, and that is a deliberate, stated delta from the MCP era's
`on-failure`: `codex exec` is non-interactive, so nobody can answer an approval prompt — `on-failure`
could only hang or fail. For `codex-implement` the human control is unchanged and lives in the skill:
its Step 3b displays the complete changeset by its own procedure and asks the user to accept, reject or modify each item. The command belongs to the skill, not here — naming it in both places is what let this file keep saying `git diff` after the skill had corrected it.

## Resume

```bash
node <locator> --protocol 1 resume --thread-id <uuid> --class <the caller's class> \
  --prompt-file <dir>/prompt.md --report-file <dir>/report.md [--profile <name>]
```

**The class is the caller's, exactly as on § Start, and it does not change across a thread**: a
`codex-implement` continuation resumes with `--class implement` or Codex cannot make the edits the
reply asks for; every other caller resumes with `--class review`. Naming one class here would have
silently downgraded write-capable continuations to `read-only`.

`resume` continues the thread the previous dispatch returned. Keep the term `threadId` in skills and
reports; it is what `--continue <threadId>` has always meant. Nothing persists it — the orchestrator
remembers it in conversation, and `review-state.js` deliberately carries no thread id.

Rotation is unchanged and stays behaviour-layer: at the R-a threshold or on judged context overrun
(`review-common.md` § Review Loop — Thread Rotation), the next dispatch is a **`start`** on a new
thread with the family's first-dispatch template, and `[THREAD_ROTATED]` is recorded. The adapter
knows nothing about rounds or rotation.

## Cleanup

```bash
node <locator> --protocol 1 cleanup <dir>
```

Refuses any path that is not an `alloc`-shaped directory under the OS temp dir. It stays the
caller's step and the only *prompt* removal; what a caller forgets is reaped by the next `alloc`
after a day (§ Alloc) — a backstop for the caller that is gone, not licence for the one that is
not, since a directory left behind holds a report and an event log until then.

## Completion state machine

**This section governs `start` and `resume` only.**

| Outcome | Reading |
|---------|---------|
| Launched, not yet finished | `pending` — a launch is **not** a verdict. No gate verdict, no probe result, no `review-state.js` note exists yet |
| Exit 0 | `codex_ok`. Requires **all** of: the child exited 0, a valid `threadId`, a non-empty report **that is still a regular file at exactly `0600`** (the adapter re-reads the mode it created the report with and refuses to call a widened or replaced report a success — § Files' last layer) — **and the whole prompt written without a write error** (the stdin stream reached `finish`). Not pedantry: a child that dies mid-write on a 2 MiB prompt still emits a valid thread event and writes a valid report, so without this conjunct the adapter reports a completed review of a prompt the reviewer only half received (measured; `test/scripts/codex-exec.test.js`). **Its limit, stated because the honest claim is narrower than it looks**: `finish` proves the bytes entered the pipe, never that the child read them. A prompt small enough to fit the pipe buffer is fully written even if the child reads one line and exits — that run exits 0 and nothing here can tell. Proving *consumption* needs an acknowledgement in the child's own protocol, which `codex exec` does not offer; the residual is accepted and characterized in that suite rather than papered over. One control record on stdout: `{"protocol":1,"threadId":…,"reportFile":…,"requestedProfile":…,"class":…}`; the report is at `reportFile` |
| Exit 1 | `codex_fail` — `[CODEX_EXEC_ERROR] reason=…` on stderr. **What follows depends on what the dispatch carries.** A gate family with a carrier (`code`, `doc`, `plan`, `test:*`) routes through `scripts/lib/review-dispatch.js` with `probe:'codex_fail'`, records `[REVIEWER_FALLBACK]`, and stays on the fallback path for the rest of this change — sticky means Codex is not re-probed, **not** that one carrier is fixed: a failed validation advances to the next carrier in the family's list. The next change probes afresh. **`necessity` is a gate with no carrier** — its Codex debate pipeline is constitutive, so `review-dispatch.js` defines none and it degrades terminally in place (`@rules/auto-loop.md` § Review Dispatch excludes it from fallback and rotation); an earlier draft of this row listed it with the others, which the dispatcher contradicts. A **non-gate conversation** dispatch — brainstorm, explain, implement, recap, verdict — has no contract in that table at all: it degrades in place, says so in its own output, and notes nothing. Sending one through `review-dispatch.js` is not a stricter reading, it is an unexecutable instruction |
| Exit 2 | Configuration or usage — `[CODEX_EXEC_CONFIG]` / `[CODEX_EXEC_USAGE]` with a `code=`. Fix the setup; **no reviewer was dispatched**, so no fallback and no note |
| Completion status unknown | The gate **stays open**. No fallback, no note, no verdict |

An `alloc` or `cleanup` failure is a lifecycle error surfaced to the operator: it never calls
`review-dispatch.js`, never sets the probe, and never counts as a Codex outcome.

A dispatch expected to approach the foreground tool ceiling — a `thorough` tier, a large diff — is
launched with `Bash(run_in_background: true)` and awaited by its completion notification. The
adapter owns no timeout and never retries.

Remediation by diagnostic code:

| Diagnostic | Action |
|------------|--------|
| adapter not found at any locator step | `/sd0x-dev-flow:install-scripts codex-exec.js` |
| `protocol_mismatch`, or exit 2 with no recognizable code from an old adapter | `/sd0x-dev-flow:install-scripts codex-exec.js --force` |
| `profile_missing` | Fix `## Codex Profile`, or create `$CODEX_HOME/<name>.config.toml` |
| `invalid_class`, `invalid_profile_name`, `invalid_prompt_file`, `invalid_report_file`, `invalid_progress_file`, `invalid_thread_id`, `invalid_dir`, `no_git_toplevel` | Correct this invocation — a choreography defect; do not dispatch a fallback. `invalid_progress_file` means something already sat at `<alloc>/events.jsonl` or `<alloc>/progress.json`: a reused directory (one `alloc` per dispatch) or a squatter |

## Progress

**A run is observable while it runs, and nothing observable is a verdict.** Until 2026-09-05 the
adapter held the child's whole stream in memory, parsed it on `close`, and left the pre-created
report empty until the end — so for a background dispatch every artifact anyone could look at was
empty until it was over, and a healthy run read as a hang. Three channels now carry facts the stream
actually has (measured on codex-cli 0.149.0: `thread.started` comes first; `command_execution`
items open and close with a `command` and a `status`; `usage` arrives only on `turn.completed`;
nothing carries a `model`, an `effort` or a timestamp). None of them touches stdout, which stays
exactly one control record on success:

| Channel | Where | What it says |
|---------|-------|--------------|
| `events.jsonl` | `<alloc dir>`, `0600`, named in the § Alloc record | Every **non-empty** raw JSONL line, appended as it arrives (best-effort — below; a blank or whitespace-only line is dropped, exactly as the § 3.2 JSONL contract already reads the stream) — the diagnostic record; the adapter no longer holds the stream, only the one incomplete line until its newline arrives |
| `progress.json` | `<alloc dir>`, `0600`, atomically rewritten on every event and every tick | `status` (`running` / `done` / `failed`), `threadId`, `elapsed_s`, `events`, `tool` (the open command or `null`), `tools_completed`, `last_event_s_ago`, `usage` (the last `turn.completed` payload verbatim, else `null` — never zero, never a percentage), `errors` (`item.type=error` items, counted and never acted on: exit decides), `updated` |
| stderr | the adapter's own, tagged `[CODEX_EXEC_PROGRESS]` | `started thread=… class=… profile=…` the moment `thread.started` arrives; every 60 s `t=MM:SS events=N tools_completed=N tool=<cmd\|none> last_event=<Ns ago\|none> tokens=<in:X/out:Y\|unreported>`, with ` — no event for Ns, check` appended after two silent ticks; `done elapsed=MM:SS report=<path>` on success |

**Heartbeat is not progress**: a line every 60 s proves the adapter is alive, and only the
`last_event=` field says whether Codex is. The advisory is exactly that — the adapter still owns no
timeout and kills nothing (INV-003, INV-005); a hard limit would be a second knob and is not part of
this contract. Both files are created exclusively at preflight (`invalid_progress_file` otherwise)
and removed by `cleanup`; `events.jsonl` carries tool output and code, so § Files' confidentiality
layers apply to it as they do to the report.

**Reading a failure**: the `[CODEX_EXEC_ERROR]` / `_USAGE` / `_CONFIG` diagnostic is identified by
its tag, not by being the first byte of stderr — progress lines may precede it, and every line before
it is tagged. A reader that anchored on `startsWith` was reading a contract this section replaced.

**The artifacts are best-effort; the verdict is not.** Every `events.jsonl` append and every
`progress.json` rewrite swallows its own failure — a full disk, a squatter that survives the retry —
because observability must never be able to fail a run that Codex completed. What is authoritative
is unchanged: the exit code and the single stdout control record (§ Completion state machine). A
reader who finds `progress.json` behind the stderr lines, or `events.jsonl` short, has found the
best-effort channel degrading, not a verdict changing. Nor is memory use zero: the adapter no longer
holds the *stream*, but it buffers the one incomplete line until its newline arrives.

**Observing a background dispatch — the whole choreography, so it is executable rather than
described.** A dispatch expected to run long is launched in the background and observed by **push,
not poll**: a Claude-side fixed-interval read loop was considered and declined (sixteen tool calls
of context per eight-minute review, to learn what one notification says). Three steps:

1. **Launch** with `Bash(run_in_background: true)` and **redirect nothing**. stderr left attached
   is what the task's output panel shows, so the 60 s lines appear there live; stdout stays the one
   control record the task output ends with. Do **not** mirror stderr into a file of the caller's
   choosing: `2> "$DIR/adapter.err"` leaves the panel reading *No output yet* for the whole run
   (measured 2026-09-05), and `2> >(tee "$DIR/adapter.err" >&2)` — the first form this section
   shipped with — opens a predictable pathname with a tool that follows symlinks, which is the
   overwrite class the adapter's exclusive creation exists to refuse (a review caught it the same
   day). Everything the observer needs is already in a file the adapter created exclusively.
2. **Observe** `progress.json` with the Monitor tool — a local read every 30 s, no model turn,
   surfacing only **state changes**: `started` once the thread id is known, every fifth minute
   of `elapsed_s`, the stall advisory when `last_event_s_ago` passes 120, and the terminal status.
   That is about four notifications per ten-minute review, and the loop **exits on its own** when
   `status` leaves `running` — or when the file has been unreadable for three polls, a full
   60 s (below). The
   Monitor is armed with **`persistent: true`** — the adapter owns
   no total timeout, and a watcher that dies at the tool's default five minutes would go silent
   before the example above ends — and its returned task id is kept for step 3:

   ```bash
   P='<progressFile from the alloc record of this dispatch, pasted literally>'; seen=; mark=0; stalled=0; miss=0
   while :; do
     if [ -f "$P" ] && r=$(node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (j.protocol !== 1 || !["running", "done", "failed"].includes(j.status)) process.exit(1); console.log([j.status, j.threadId ?? "", j.elapsed_s ?? 0, j.last_event_s_ago ?? ""].join("|"))' "$P" 2>/dev/null) && [ -n "$r" ]; then
       miss=0; IFS='|' read -r st id el age <<< "$r"
       [ -z "$seen" ] && [ -n "$id" ] && { echo "started thread=$id"; seen=1; }
       m=$(( ${el:-0} / 300 )); [ "$m" -gt "$mark" ] && { echo "t=$((m * 5))m elapsed, last event ${age:-?}s ago"; mark=$m; }
       [ "${age:-0}" -ge 120 ] && [ "$stalled" = 0 ] && { echo "no event for ${age}s — check"; stalled=1; }
       [ "${age:-0}" -lt 120 ] && stalled=0
       case "$st" in done|failed) echo "$st after ${el}s"; exit 0 ;; esac
     elif [ $((miss += 1)) -ge 3 ]; then
       echo "progress unreadable for 60s — dispatch ended, cleaned up, or wrong path"; exit 0
     fi
     sleep 30
   done
   ```

   **The watcher is bound to the file's readability, not to its own patience.** Three consecutive
   polls without a `progress.json` that parses **and is a snapshot** — the first poll runs at
   once and each later one after a 30 s sleep, so three misses is the 60 s the line claims (two
   would have been 30 s: a review measured the first version cutting a slow preflight's grace in
   half) — `protocol` 1 and a
   `status` of `running`, `done` or `failed`; a stable `{}` or the preflight-written `starting`
   record counts as a miss, so a wrong path that happens to hold JSON still ends the watcher (a
   code review measured the unvalidated form polling `{}` forever) — end it with the line above,
   which is what happens
   after `cleanup` removes the file, when the path was pasted wrong, or when the dispatch failed at
   preflight before writing it. Measured 2026-09-05 before this clause: seven watchers from
   dispatches that had been cleaned up hours earlier were still polling, because the only exit was a
   terminal `status` that a deleted file can never carry, and a context compaction had dropped the
   task ids a **TaskStop** would have needed. Silence from a watcher must mean *running*, and only a
   watcher that dies on its own can keep that promise.

   **`P` is written literally, never as `$DIR/progress.json`.** The Monitor command runs in a shell
   of its own, and a shell variable assigned in the alloc call does not exist there (the same rule
   `skills/smart-commit/SKILL.md` § Step 5c states for its locator: each fence is one shell). An
   unbound `$DIR` resolves to `/progress.json`, and a persistent watcher on that path emits nothing
   forever — a doc review measured exactly that. The alloc record carries `progressFile` so the
   caller has the exact string to paste; nothing derives it. **Paste it as a shell single-quoted
   literal, and an apostrophe inside it is written `'\''`** — the rule
   `skills/smart-commit/SKILL.md` § Step 3 already states for its `--scope` path, for the same
   reason: the temp root is environment-chosen, a directory name may contain a quote, and a raw
   paste then hands the Monitor an unbalanced command that never starts (a code review measured
   it). The parsing is **structural, through `node`** — the runtime every dispatcher already
   requires for the adapter itself — and not a `sed` over the text: `progress.json` carries the
   child-sent `usage` object verbatim after the top-level fields, so a greedy text match on
   `"status":` reads a key nested inside that object when the child puts one there, and a forged
   `status:"failed"` in `usage` would have stopped the watcher while the child was still running
   (a code review measured it). Reading the parsed object's top-level fields cannot be steered by
   anything nested. No partial read is possible either: the rename is what makes the file whole or
   absent. Between
   notifications the operator can talk; asked for the current state, read `progress.json` once and
   answer from it. A progress line, whatever it reports, is never a verdict, a probe result or a
   `review-state.js` note: those exist only after completion status is known.
3. **Terminate** on the background task's completion notification — that, not the Monitor, is
   what says the run ended and with which exit code. Read the report, then `cleanup`: it removes
   `progress.json`, and the watcher ends itself within three polls of that (the clause above), so
   nothing is left to stop. **TaskStop** with the id kept at step 2 is the way to silence it
   *sooner* than that minute — an option, no longer an obligation the choreography depends on,
   which is the point: an obligation that lives only in the conversation does not survive a
   compaction, and the seven orphans above were what its failure looked like.

**Who may observe this way.** The Monitor tool delivers its notifications to the session that
armed it: a skill that runs in the **parent** session (the `codex-code-review` family declares no
`context` key) can prescribe this recipe and must then grant `Monitor` in its `allowed-tools` —
`skills/watch-ci/SKILL.md` is the precedent, and `test/skills/watch-ci.test.js` pins both halves
for it. A skill that runs under `context: fork` (`doc-review`, `test-review`) cannot receive
those notifications and does **not** prescribe the recipe: it launches the same way and awaits the
completion notification alone, with `progress.json` there to read on demand. § Permission carries
the grant rule.

`CODEX_EXEC_TICK_MS` shortens the cadence for the fixture tests, whose runs finish in milliseconds.
It is a test seam, not a configuration knob — § Profile is the one knob (INV-006), because it changes
what a dispatch *does*; this changes only how often it is described.

## Profile

`rules/auto-loop-project.md ## Codex Profile` names one Codex profile for every dispatch; unset means
no `-p` and Codex's own default configuration. The adapter fail-closes when
`$CODEX_HOME/<name>.config.toml` does not exist, because `codex exec` otherwise runs an unknown
profile **silently** (measured 2026-09-03, codex-cli 0.149.0).

**Profile selection is not tier-dependent in v1.** `## Codex Profile` selects one user-defined
profile for all Codex `start` and `resume` dispatches. The auto-loop tier continues to govern review
scope, blocking severity and round caps. A tier-to-profile map is a future setting and must not be
inferred from profile names.

The profile is *project-selected, user-defined* configuration: the name lives here, the definition
lives in the operator's `$CODEX_HOME`, so two machines can resolve it differently. The
`requestedProfile` field in the control record is the audit trail.

## Permission

A skill that dispatches Codex itself declares `Bash(node:*)`, `Write` and `Read` — `plan-review` is
the one exemption, and § Files says why. A skill that only routes to another skill carries no
dispatch instruction in its body and is issued no **transport** grant — no `Bash(node:*)`, no
`Write`.

That is narrower than "no Bash grant", deliberately: a router keeps whatever `Bash(git:*)` or
`Bash(bash:*)` its own steps already needed (`codex-review-fast` and `codex-review-branch` hold both,
`codex-review-doc` holds the first). **What that retention states is ownership, not enforcement.**
`Bash(bash:*)` can run node, this adapter, or `codex` itself, so no grant string prevents a dispatch
and none is claimed to — the boundary is that the router's documented workflow contains no dispatch
and it receives nothing extra with which to perform one. `Bash(node:*)` is no different: it is
equivalent in effective authority to `Bash(bash:*)`, so the real boundary is the adapter's pinned
safety flags and its class sandbox, never the grant string.
`test/rules/codex-transport-guards.test.js` Guard 4 pins the router pair in both directions.

**`Monitor` is a separate grant with a separate condition** (§ Progress). A skill whose workflow
prescribes the Monitor recipe declares `Monitor` in `allowed-tools`, and so does every thin entry
point through which that workflow is reached, because the entry point's frontmatter is the
effective permission boundary when it is the one invoked — today that is `codex-code-review` and
`codex-review`, `codex-review-fast`, `codex-review-branch`. A skill that runs under
`context: fork` never declares it: the notifications could not reach the conversation, so the
grant would authorize a step the skill cannot perform. `test/skills/codex-transport.test.js` pins
the four grants and the absence of a `context` key beside them.
