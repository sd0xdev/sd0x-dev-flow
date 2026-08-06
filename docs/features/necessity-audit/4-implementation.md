# Necessity-Audit Scripts — Implementation Notes

Forensic record of why `scripts/skills/necessity-audit/cleanup.js` has the shape it does. Migrated from ≥30-line comment blocks in the script itself (R5 comment policy — `rules/docs-writing.md` § Code Comments).

## 1. cleanup.js — why a script, a claim marker, and a capability token

**Why a script.** The cleanup step used to be a bare `rm -rf -- "<AUDIT_TMP_DIR>"` in SKILL.md, with the safety condition ("the path must be the exact absolute path `mktemp -d` printed") written as prose addressed to the model. Prose is not a control: nothing executes it, so the one run where the placeholder is mis-substituted is also the run where nothing checks. The failure is unrecoverable — on macOS `TMPDIR` already points at the **shared** temp root (`/var/folders/…/T/`), so the natural mistake substitutes a path one level too high and deletes every other process's scratch space. `allowed-tools` already carries `Bash(node:*)`, so the scripted guard runs without widening permissions.

**Why a claim marker, not just a shape check.** Shape alone ("an absolute `tmp.XXXXXXXXXX` under a temp root") is satisfied by *every* concurrent process's scratch directory — a mis-substitution naming a different valid scratch dir still passes and still deletes someone else's work. The delete is therefore bound to a marker this skill writes at creation: `--claim` stamps the directory; `--dir` refuses one that was never stamped.

**Why the marker carries a capability token, not just a name.** Presence-only authorization distinguishes "claimed by this skill" from "not claimed" — but every concurrent necessity-audit run claims its own directory, so the exact case the marker was introduced for (a substituted path naming a directory that is not *this run's*) stays open the moment two audits overlap. `--claim` mints an unguessable token, stores it in the marker, and prints it; `--dir` requires that exact token. Presence proves membership; the token proves identity — and identity is what the skill promises.

CLI and exit codes are documented in the script header (`--claim <path>` / `--dir <path> --token <hex>`; 0 = claimed/removed, 1 = refused, 2 = usage).

## 2. fd-bound removal — why not `rmSync` after an identity check

The previous shape ran every check — temp-root containment, not-a-symlink, marker present, token match — against a **path**, then handed that path to `rmSync`, which resolves it *again*. Check-then-act on a name narrows the window; it does not close it: in the surviving window another process renames the authorized directory away, drops a different real directory at the same name, and the recursive delete lands on the substitute. (The old comment claimed the residual was "abort"; nothing after the swap performed a check, so it was "delete the attacker's directory".)

**What it does instead:** `process.chdir()` into the directory and verify the resulting cwd against the held `O_DIRECTORY|O_NOFOLLOW` fd. The cwd is then a kernel-held inode reference — relative names resolve from it, and no rename or symlink swap above can redirect that resolution. The whole recursive destructive phase happens inside the inode the token authorizes.

That leaves exactly one path-resolved operation, deliberately the **non-destructive** one: `rmdirSync` on the now-empty directory. `rmdir` refuses a non-empty directory, so a substitute swapped in at the last instant fails with `ENOTEMPTY` rather than being erased — the only surviving outcome of a perfectly-timed swap is removal of an *empty* directory, which destroys nothing. A real reduction in what the residual can cost, not a smaller window on the same loss.

**Why the removal is split in two exported halves.** The one open window is the instant between "the authorized inode is empty" and "rmdir the name". Both halves are synchronous, so nothing in-process can interleave there — which also means a test cannot reach that instant through `removeVerified` alone. Exporting the halves lets a test act exactly where an attacker would, using the real production code on both sides of the seam with no test-only branch inside it; `removeVerified` is their composition and is itself covered, so the split cannot drift from what the CLI runs.

## 3. report.js — neutralizing foreign gate sentinels

The audit report is free text a caller controls, and it is emitted where `stop-guard.sh` scans for gate verdicts. Its rationale prose therefore has to be prevented from *being* a verdict.

**stop-guard's recency scan is coarser than the sentinel list it nominally reads.** Its blocking scan is `⛔.*(Block|Needs revision|Must fix)` — any line carrying `⛔` and one of those words. That direction fails **closed** (a spurious "review not passed"), so it cannot leak a pass; but it would let an audit narrative invalidate an unrelated, genuinely passing gate. That is the same class of cross-plane interference, and the reason the audit's own verdict is spelled `⛔ Audit Revise` rather than `⛔ Audit Needs revision`.

**The other half of that coarseness fails OPEN.** The passing scan is `## Gate: ✅|✅ Mergeable|✅ Ready|Gate.*PASS`, and the last alternative needs no emoji, no header and no colon: *any* line holding the word `Gate` with `PASS` later on it reads as a passing review verdict. The `##\s*Gate:` entry in the elision list covers only the literal header, so an audit rationale reading "the Gate should PASS once the adapter is removed" went out verbatim and handed the transcript fallback a code-review pass no reviewer ever emitted.

**Elide the `Gate` token, not the verdict word.** `PASS`/`FAIL` carry the audit's own meaning in prose about test outcomes, while `Gate` is the token stop-guard anchors on — removing it breaks the match without rewriting what the sentence says. `FAIL` gets the same treatment even though `Gate.*FAIL` fails closed, because an audit narrative must not be able to invalidate an unrelated passing gate either. The report's own `### Gate` header survives: it carries neither word on its line.

### 3.1 Why `_elideBeforeTrigger` is not a lookahead regex

Both coarse rules were once single regexes — `/⛔(?=[^\n]*(?:Block|…))/g` and `/Gate(?=[^\n]*(?:PASS|FAIL))/g`. Both ask the same question ("is there a trigger word later on this line?"), and a `(?=[^\n]*…)` lookahead answers it by re-scanning to end-of-line **once per token**: quadratic in tokens-per-line, and measurably so. One line of 40 000 tokens took **533 ms** for `⛔` and **1 314 ms** for `Gate` — the latter worse only because `Gate` is four characters of scanning per attempt. Reports are assembled from caller-controlled free text and the JSON branch sweeps every string in the structure, so nothing bounds line length here.

`_elideBeforeTrigger` computes the answer **once** for the whole input: find where the last trigger starts, then keep only the tokens ending at or before it. Semantics are preserved exactly — a token is elided iff a trigger occurs *after* it, which is what the lookahead meant.

The input is the **whole text**, not one line (see `neutralizeForeignGates` for why the line was the wrong unit). The ordering rule is what keeps that widening safe: the simpler alternative — "elide on any trigger anywhere" — would elide `⛔ Audit Revise` whenever the document said "Must fix" earlier, and the audit's own vocabulary surviving is a property this module is tested on. Because a token is elided only when a trigger **follows** it, and the gate sentinel is the last line of the report by contract, widening the window cannot reach it.
