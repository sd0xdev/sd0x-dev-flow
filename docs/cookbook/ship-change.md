# Finish and Ship a Change Cleanly

## Use this when

Your code is reviewed and tested, and you need to commit, push, create a PR, and get it merged — the "last mile" of the development cycle.

## Core skills

| Skill | Role |
|-------|------|
| `/pr-review` | Self-review checklist before committing |
| `/smart-commit` | Group changes into cohesive commits with good messages |
| `/push-ci` | Push with safety gates + CI monitoring (delegates to `/watch-ci`) |
| `/create-pr` | Create GitHub PR with auto-generated summary |

## Command flow

1. `/pr-review` — run through self-review checklist (code quality, test coverage, docs)
2. `/smart-commit --execute` — group uncommitted changes by cohesion, generate messages, commit
3. `/push-ci` — push to remote with safety confirmation, then monitor CI (delegates to `/watch-ci`, whose default is Monitor streaming — non-blocking; the verdict is reported when the run completes). `/push-ci` has **no `--blocking` passthrough** — its arguments are `--timeout`, `--force-with-lease` and `--set-upstream`, and Phase 3 always delegates in streaming mode. To wait inline, invoke `/watch-ci --blocking` yourself after the push
4. `/create-pr --execute` — create PR with auto-generated title and summary (default is `--dry-run` preview)
5. Share PR URL for review

## Decision points

| Situation | Choice |
|-----------|--------|
| Multiple logical changes mixed? | `/smart-commit` auto-groups by cohesion |
| Want AI co-author attribution? | `/smart-commit --execute --ai-co-author` |
| CI fails after push? | Read failing logs, fix, re-push |
| Need to merge multiple PRs? | `/merge-prep` for pre-merge analysis |
| Pushing to protected branch? | `/push-ci` warns and asks for approval; terminal confirmation follows only where the opt-in `pre-push` hook is installed |

## Gates

| Gate | Enforced by | Sentinel |
|------|------------|----------|
| Pre-push safety | git hook (`pre-push-gate.sh`) — **opt-in**, `/codex-setup sync --with-push-gate` | Terminal `/dev/tty` confirmation when installed **and the push falls in one of two classes**: a protected branch with `ALLOW_PUSH_PROTECTED` unset, or a push that **overwrites** a ref with `ALLOW_FORCE_UNSHARED` unset. That second class is narrower *and* wider than "actually rewrites history", and both directions matter. **Narrower**: `scripts/pre-push-gate.sh:389`–`:391` requires a non-null OID on **both** sides and the two to differ before it tests anything — so a ref **creation**, a ref **deletion** and an unchanged ref reach neither prompt, by design, because none of them overwrites a line of history. **Wider**: within that set the test is read fail-closed, since line 392 negates `git merge-base --is-ancestor` with `!`, which collapses *not an ancestor* and *the ancestry test could not answer* — a corrupt or unreadable graph — into the same branch; and for an existing **tag** the ancestry answer is overridden entirely by `\|\| is_tag_ref`, so every update to one is in the class, forward moves included (`rules/git-workflow.md` § Push safety states the per-ref-class rule). They ask different questions — *may this branch be pushed to at all* versus *is anybody else working on these refs*. For every **permitted** push in neither class, and whenever the hook is absent, `/push-ci`'s AskUserQuestion is the authorization (a non-fast-forward push without `ALLOW_FORCE_WITH_LEASE=1` is refused outright rather than authorized by either layer). **With the hook absent, a history-rewriting push still owes the second question**: `/push-ci` and `/epic-merge` must ask, by name and *before* the force approval, whether the rewritten refs are shared, and refuse without that answer — approving a force form is not evidence about who else holds the branch, so an absent gate moves the question rather than deleting it (`rules/git-workflow.md` § Push safety) |
| CI | GitHub Actions | Pass/Fail |

## Expected outcome

- Clean, well-grouped commits with descriptive messages
- Pushed to remote with CI passing
- PR created and ready for team review
- Clean working tree

## Related scenarios

- [Implement a new feature](new-feature.md) — the development flow before shipping
- [Resolve PR review comments](pr-review-comments.md) — if the PR gets feedback
