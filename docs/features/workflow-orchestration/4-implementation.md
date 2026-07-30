# Orchestrate Scripts — Implementation Notes

Forensic record of why the `/orchestrate` support scripts have the shape they do. Migrated from ≥30-line comment blocks in the scripts themselves (R5 comment policy — `rules/docs-writing.md` § Code Comments): this content is needed when *changing* a script, not on every read of it.

| Script | Role |
|--------|------|
| `skills/orchestrate/scripts/prune-runs.js` | FIFO retention for `.claude_workflows/` run artifacts |
| `skills/orchestrate/scripts/validate-plan.js` | v1 admission controller for planner-produced plans |
| `skills/orchestrate/scripts/run-verify.js` | Pre/post no-change verification (SC-2 hard backstop) |

Threat model note: unlike the auto-loop hooks (cooperative — see `../auto-loop-evolution/4-implementation.md` §4.6), these scripts assume an **adversarial** fanout worker that may mutate the repo. That difference drives every design below.

## 1. prune-runs.js — containment and TOCTOU

**Why a script at all.** The retention rule ("keep the 10 most recent runs") lived only as prose in SKILL.md — unexecutable twice over: `/orchestrate` grants no tool that can remove anything (`allowed-tools` has `Bash(node:*)`, no `Bash(rm:*)`), and a prose rule cannot be regression-tested. Untended, each run leaves an ~81 KB `plan-context.json` — a packet carrying the full skill catalog and repo signals, so the pile is both garbage and leak surface.

**A run occupies two paths** — `<root>/<run-id>.json` (run-state) and `<root>/<run-id>/` (packet + plan). Deleting only the `.json` is the failure the script exists to prevent: a run counts as present if *either* path exists, and pruning removes both.

**Containment: the target is derived, never accepted.** `root = realpath(git rev-parse --show-toplevel of --repo) + '/.claude_workflows'`. There is deliberately no `--root` flag — an earlier revision had one, guarded only by a basename check, and `--root /somewhere/else/.claude_workflows --keep 0` recursively removed run-shaped artifacts in a directory belonging to no repository. `--repo` selects a *repository* whose workflows directory is then derived; it cannot name the deletion target directly. Entry names are read from the directory itself and must match the run-id grammar (`<UTC yyyymmdd-HHMMSS>-<intent-slug>`) exactly; anything unrecognized is left alone and reported.

**TOCTOU: stop resolving paths at delete time.** A path-based delete is unfixable by re-checking the path — `fs.rmSync("<root>/<id>")` re-resolves every component, so a concurrent rename of the root plus a symlink in its place redirects the recursive delete no matter how recently the root was `stat`ed (an earlier revision did exactly that and documented the window as "narrow"; it was the whole interval between two separate path walks). Node has no `unlinkat`/`openat`, but a **relative** name resolves from the kernel-held cwd reference — an inode, not a string:

1. Open an fd on the root with `O_DIRECTORY | O_NOFOLLOW` before anything else.
2. `process.chdir(rootReal)` — itself still raceable, which is why the next step compares `stat(".")` against `fstat(fd)`; a chdir that landed anywhere else aborts before any destructive syscall.
3. From then on the binding is between two kernel objects. Enumeration reads `"."`, every removal names a bare entry — renaming/moving/symlinking the root cannot redirect where deletes land.
4. `assertCwdIsRoot` runs before **every** removal (a run owns two artifacts, and the exported `removeChild` enforces its own precondition rather than trusting the caller).
5. Each child is re-`lstat`ed immediately before its own removal; one that changed type since enumeration is skipped and reported.

A child swapped for a symlink does not escape: enumeration rejects symlinks up front (a run-id-shaped link is reported in `unknown`, not treated as a run), directory descent opens each child `O_NOFOLLOW` — a symlink substitute fails that open instead of being followed — and the per-entry `lstat` recheck routes anything symlink-shaped to `'skipped'`. Deep links inside a run directory hit the same `O_NOFOLLOW`/quarantine path during the pinned walk (§1.1), so a link is at most detached, its target untouched. Enumeration rejection, the `lstat → skipped` recheck, and deep-link quarantine are pinned by tests; the child-open `O_NOFOLLOW` covers the residual lstat→open swap interval by construction and has no dedicated race test. The remaining non-escape: an entry concurrently renamed *out* of the root simply is not there to delete — `ENOENT` reports it `absent`, so a run whose artifacts all vanished lands in `already_absent` (never inflating the pruned count), while one that lost only its second artifact still counts as `pruned` for the artifact this call did detach.

**Ordering** is by run-id string — chronological by construction (zero-padded UTC prefix), immune to the mtime reordering a restore or `touch` causes. Ties cannot occur: same second + same slug is the same run.

### 1.1 The pinned removal walk — why not `rmSync` per child, and why deletes rename first

**`rmSync(name, {recursive:true})` was rejected for child removal.** Pinning the root (§1 steps 1–5) proves the *parent*, not the identity of each entry resolved beneath it. A recursive delete re-resolves the name and then walks whatever it finds — so a run directory renamed away after the type check, with an unrelated directory moved in under the same run id, gets the substitute erased. Rejecting symlinks does not help: the substitute is a real directory, exactly what the walk expects. Instead each descent carries `expect` — the `{dev, ino}` identity observed at enumeration — and that is the load-bearing half: opening the child `O_NOFOLLOW` and proving the `chdir` against that descriptor binds open→chdir, but if the swap landed *before* the open, every one of those checks is self-consistent on the substitute. Coming back up has no portable primitive (Node exposes no `fchdir`), so `..` is just another name; that cannot be prevented, but the parent's descriptor is still open, so a `..` that lands somewhere else is *detected* before anything further is removed. The closing `rmdir` is non-recursive — the only unbound path-resolved destructive step, and non-destructive by construction because `rmdir` refuses anything non-empty.

**Non-directory deletes rename before they unlink** (`unlinkVerified`). Both regular-file deletes originally re-resolved the name at the destructive step: `removePinnedChild` verified the inode and then unlinked by name, and `removeChild` verified only the *shape* (`isFile`) with no inode binding at all — weaker than its own sibling branch three lines above, which passes `{dev, ino, dir:true}` down to the pinned walk. The ordering is the point: `lstat → compare → unlink` destroys the wrong file if a swap lands in the second window; `rename → lstat → compare → unlink` relocates it and reports instead. Relocation is recoverable, deletion is not. The quarantine name is random so it cannot be aimed at — unpredictability, not atomicity, is the property relied on, since Node exposes no unlink-by-descriptor. This is not a privilege boundary: renaming a file in requires write permission on that file's own parent, which already allows unlinking it directly (fuller argument: `../necessity-audit/4-implementation.md` §2 on `unlinkVerified` in cleanup.js). A retained substitute stays under its `.quarantine-*` name — the deliberate evidence trail of a refused delete, not debris to clean blindly — and a post-rename ENOENT counts as `removed`, not `absent`: the rename already detached the original name, so the artifact was pruned regardless of who cleared the quarantine afterwards.

## 2. validate-plan.js — the report-only security boundary

The rule list (A1–A4, G1–G2, O1, B1, S1, SCHEMA) is summarized in the script header; the part that needs an argument is **why the planner-supplied `mutating` flag is not the guard**:

- A lying `mutating:false` on an actually-mutating target (e.g. `/bug-fix`) passes A3+A4 — the flag is planner input, not evidence.
- `disallowed-tools: Skill` is deliberately **avoided**: it stays active until the next user message (per Claude Code), which would also block the mandatory same-turn `/codex-review-doc` handoff — itself a Skill invocation — so the run could never reach its Mergeable/`done` gate. Omitting Skill from `allowed-tools` (which v1 does) is only a pre-approval signal, not a hard block.
- The primary backstop is `run-verify.js`'s SC-2 pre/post no-change proof: baseline snapshotted **before** any dispatch, re-compared after, so any mutation within the monitored git-scoped surface — including one an errant main-skill dispatch caused — surfaces as fail-closed drift → run marked failed, no report written.
- That backstop is **best-effort fail-closed, not absolute**: out-of-repo writes, `node_modules/`, `.venv/`, build artifacts, and index-hiding (`assume-unchanged`/`skip-worktree`) are documented residuals (SKILL.md report-only section + `admission-allowlist.json` `residual_risk`). v1 report-only strength rests on admission curation.
- When main-skill execution lands (v2), enabling it requires `skill_candidates` carrying a mutation flag so a mutating main-skill target is rejected at admission, plus a reviewed read-only allowlist.

## 3. run-verify.js — what each check catches

Each snapshot field exists because porcelain alone misses a bypass class:

| Check | Bypass class it closes |
|-------|------------------------|
| `head` / `branch` | Sneaky commit (worktree stays clean) / `git checkout -b` |
| `porcelain_sha256` | File edits, new untracked (`-uall` — mirrors the stop-guard `-uno` lesson) |
| `tracked_diff_sha256` | Content edits to already-dirty tracked files (porcelain records status+path, not content) |
| `untracked_content_sha256` | Same blind spot, untracked side |
| `ignored_content_sha256` | Edits to gitignored files (`.env`, generated artifacts) — invisible to porcelain *and* `ls-files --exclude-standard`; excludes harness/control/safety planes + `node_modules/` |
| `ignored_dirs_sha256` | Create/delete/chmod of an **empty** ignored directory (no leaf file to hash) |
| `refs_sha256` | Tag/branch/ref creation or movement |
| `local_config_sha256` | Local git config tampering, incl. `core.hooksPath` |
| `worktrees` / `stash_count` | Sneaky worktree creation / stash hiding changes |
| `git_internals_sha256` | `.git/hooks/*` (planted-hook persistence), `.git/info/exclude` (hides matching untracked writes from porcelain *and* ls-files) |

Any git failure → exit 1: an unverifiable repo **is** drift. `compare` requires `--baseline-sha256` because without it "compare against the baseline" degrades to "compare against whatever file I was handed", which a post-mutation re-snapshot satisfies trivially.

### 3.1 Hashing ignored paths — per-type classification

`git hash-object` **follows symlinks** and dies on a symlink-to-directory — and this repo ships exactly those (`.claude/agents -> ../agents`), which land in the ignored listing; passing one straight through aborts the whole snapshot → fail-closed on a benign repo. So each path is classified by `lstat`:

| Type | Treatment |
|------|-----------|
| Symlink | Hash the **link target string** — also catches an ignored symlink being repointed, which follow-then-hash would miss |
| Regular file | Batched `git hash-object` (fast path) — carries the one documented residual below |
| Directory | Recursive content digest — an embedded repo lists as a lone `nested/` entry, and a static type marker cannot see internal mutations (fail-open), so every descendant's path + content is digested |
| Special | A type marker — drifts on a type swap, never crashes |
| Unresolvable | **Throw** (fail-closed) — see below |

**Regular-file residual (documented, accepted):** `git hash-object` has no `--no-follow`, so a raced `lstat(isFile)` → hash swap to a symlink-to-*file* hashes the target, not the node. Left unfixed because (a) it needs an adversary mutating *during* a single snapshot/compare call, but the verifier runs only when no fanout worker is live (SKILL.md ordering) — the same out-of-model lingering-adversary class as the other TOCTOU residuals; (b) a symlink-to-directory still fail-closes; (c) closing it means re-implementing git's object hashing, forfeiting object-model consistency; (d) any post-snapshot swap still drifts on the next non-raced snapshot. Tracked in `references/admission-allowlist.json` `residual_risk`.

**Why unresolvable throws instead of a constant marker:** `ls-files` just emitted the path, so an `lstat` failure has two causes and a constant `GONE` marker mishandled both. (1) A **non-UTF-8 filename**: `git()` decodes `ls-files -z` as utf8, mapping invalid bytes to U+FFFD; the mangled path then lstat-fails — and since the marker recorded identically at snapshot *and* compare, mutating that file's content drifted in neither porcelain nor the digest → compare wrongly returned `{ok:true}` (fail-open). (2) A genuine TOCTOU vanish mid-snapshot. Throwing routes both to snapshot's fail-closed catch, and still registers drift on the vanish. Positions are preserved so the caller's pre-sorted order is stable across snapshots.
