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
