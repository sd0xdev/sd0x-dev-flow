# Non-gate conversations: switch to the exec transport

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-03
> **Status**: Candidate Complete
> **Note**: Work item 4 of 6 in the tech spec's § 5. The skills here hold conversations, not gates; the one that mutates the workspace (`codex-implement`) is the sole `--class implement` owner, and `necessity-audit` keeps its fallback exclusion.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 3.2 Operation classes; § 3.4
> **Depends On**: [Core review family: switch to the exec transport](./2026-09-03-core-review-family-transport-switch.md)
> **Intent**: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) <- INV-002, INV-004, INV-007 bind this ticket

## Background

Nineteen skills use Codex as a conversation partner — brainstorming, architecture, explanation,
implementation, feasibility, recaps, verdicts. They share the envelope shape the review family
just dropped, plus two policies the fixed classes must preserve honestly: `codex-implement`'s
`workspace-write` sandbox and the `on-failure` approval that has no headless equivalent.

## Requirements

- Same conversion as item 3: body-only prompts, call sites cite `codex-transport.md`, direct
  owners gain `Bash(node:*)` + Write + Read and lose the MCP grants. Every in-scope frontmatter is
  classified **per file, here**: a skill that dispatches Codex itself is a direct owner; a thin
  entry point that routes to a sub-skill (`codex-security` → `security-review`, and any other
  found the same way) loses its unused MCP grant and gains nothing; every in-scope frontmatter
  `description` **containing `Codex MCP`** (e.g. `codex-security`'s "using Codex MCP") replaces
  the phrase with `Codex exec`. Only `codex-test-gen` and `feature-dev` are left untouched for item 5.
- `codex-implement` dispatches with `--class implement`; its Step 3b accept/reject loop (`git diff`
  → user) is stated as the human control that replaces `on-failure`; every other skill uses `review`.
- `codex-brainstorm` and every other former `on-failure` caller document the `never` mapping once,
  by citing the transport reference — not by restating it.
- `necessity-audit`: every debate turn maps to `resume`; its exclusion from fallback and rotation
  (`review-dispatch.js`, `review-common.md`) is unchanged and re-asserted by its test.
- `feasibility-study` (hybrid `Bash(codex:*)` + MCP) and the three agents declaring `Bash(codex:*)`
  without using it are normalised: the dead `scripts/codex_architect.sh` reference in
  `agents/feasibility-analyst.md` is removed.

## Scope

| Scope | Description |
| ----- | ----------- |
| In | Exactly spec § 5 item 4: `codex-brainstorm`, `codex-architect`, `codex-explain`, `codex-implement`, `feasibility-study`, `issue-analyze`, `recap-ask`, `recap-doc`, `post-dev-recap`, `fp-brief`, `req-analyze`, `architecture`, `debug`, `code-investigate`, `security-review`, `codex-security`, `necessity-audit`, `feature-verify`, `load-pr-review`, `review-spec`; `best-practices` (terminology only — it holds no grant); `agents/{codex-architect,codex-implementer,feasibility-analyst}.md` |
| Out | Anything in item 3's list; the two untouched delegator frontmatters (`codex-test-gen`, `feature-dev`), README, catalog, `sharingan`, the allowlist-free state of Guard 2 (all item 5); `codex-cli-review` (stays a `codex review` niche skill, untouched) |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/<each in-scope skill>/SKILL.md` | Modify | Per-file: direct owners get the transport grants and their dispatch sentences cite the reference; in-scope thin entry points (`codex-security`, …) lose the MCP grant only — each decision recorded in Progress |
| `skills/codex-implement/references/codex-prompts.md`, `skills/codex-brainstorm/references/*.md`, `skills/recap-ask/references/qa-prompt.md`, `skills/*/references/codex-discussion-guide.md`, `skills/necessity-audit/references/review-loop.md` | Modify | Body-only prompts |
| `agents/feasibility-analyst.md` | Modify | Drop the nonexistent `scripts/codex_architect.sh` step and the unused `Bash(codex:*)` grant |
| `agents/codex-architect.md`, `agents/codex-implementer.md` | Modify | Grants match what the body actually runs |
| `test/skills/{recap-ask,recap-doc,debug}.test.js`, `test/skills/necessity-audit/*.test.js`, `test/agents/frontmatter.test.js` | Modify | Re-pin; necessity exclusion re-asserted |
| `test/rules/codex-transport-guards.test.js` | Modify | Guard 2 allowlist shrinks to the item-5-owned residue (`sharingan/scan-repo.js`, delegator frontmatters); Guard 3 now has a real positive case |

## Acceptance Criteria

- [x] No in-scope skill, reference or agent contains `mcp__codex__codex(`, `codex-reply(`, `sandbox:` or `'approval-policy':`, and no in-scope `SKILL.md` description contains `Codex MCP`. **Enforced, not just checked**: Guard 6 in `test/rules/codex-transport-guards.test.js` scans every transport participant for a restated field/value pair. It was rebuilt four times as reviewers drove mutations past it — the working version measures rather than guesses (every genuine restatement puts the value within 6 characters of the field; every false positive had them 74+ apart), uses one predicate shared by the production scan and every self-test, and takes the blank-line block as its unit so multiline Markdown cannot hide a pair
- [x] `skills/codex-implement/` is the only call-site surface containing `--class implement` (the transport reference's § Start is the other allowed mention); Guard 3 passes, and Step 3b names the accept/reject loop as the control replacing `on-failure`
- [x] `necessity-audit` maps each debate turn to § Resume and keeps `Bash(mktemp:*)` only if its body still needs it; `review-dispatch.test.js` still proves `necessity` has no fallback carrier and no rotation
- [x] `agents/feasibility-analyst.md` no longer references `scripts/codex_architect.sh` (the script does not exist and had not for some time — the step was unrunnable as written); no agent declares `Bash(codex:*)` without a `codex` command in its body (`test/agents/frontmatter.test.js` asserts it)
- [x] `best-practices/SKILL.md` no longer mentions the MCP tool names, and `test/skills/best-practices/skill-contract.test.js` keeps its structural assertion that `best-practices` holds no Codex capability while `codex-brainstorm` does — restated against the transport reference
- [x] Guard 2 passes with its allowlist reduced to the item-5-owned residue: `grep -rln "mcp__codex" skills agents rules` lists only `skills/sharingan/scripts/scan-repo.js`, `skills/sharingan/references/format-mapping.md`, `skills/sharingan/references/dependency-graph-algorithm.md`, `skills/codex-test-gen/SKILL.md` and `skills/feature-dev/SKILL.md`
- [x] `npm test` passes (4580 tests / 4572 pass / 0 fail / 8 skipped); one live `/codex-brainstorm` round and one `/codex-implement` item run through the adapter (`review` and `implement` classes respectively) and are recorded in Progress
- [x] Pass `/codex-review-fast` → `/precommit` — code gate `✅ Ready`; `/precommit` `## Overall: ✅ PASS`. Four P2 guard-strength findings were logged `[NIT_DEFERRED]` rather than fixed: at `standard` tier P2 is sub-threshold, and they are authoring-lint gaps over English prose where the closed alternative (byte-pinning normalized blocks) would fail on every legitimate wording change
- [x] Pass `/codex-review-doc` — all four conversion batches `✅ Mergeable`, plus a closing review over the lint repairs. Sixteen rounds: the loop found a repo-wide `git checkout . && git clean -fd`, an anti-anchoring violation, a shell-injection vector, two scope-disposition errors of mine, and seven cases of a change corrected in one file and not its counterpart

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Class ownership fixed by doc-review round 1 of the spec; skill list from spec § 5 item 4 |
| Development | Done | 39 surfaces across 24 skills plus 3 agents. **Frontmatter decided per file**: 15 direct owners gained `Bash(node:*)` + Write + Read; 5 held MCP grants their bodies never used (`post-dev-recap`, `req-analyze`, `codex-security`, `feature-verify`, `load-pr-review`) and lost them without gaining anything; `debug` was reclassified a router mid-review when a reviewer showed it dispatches nothing. `recap-doc` likewise became a router after its only dispatch — an unreachable `--strict` mode — was removed rather than wired |
| Testing | Done | 4580 / 4572 pass / 0 fail / 8 skipped. Guards 6 and 7 added and mutation-proven in both directions; `GUARD1_PENDING` emptied; a test allocation leak fixed (measured 44 directories per run → 0) |
| Acceptance | Done | code `✅ Ready`, doc `✅ Mergeable` ×5, `/precommit` `## Overall: ✅ PASS`, all three planes noted and `check` reporting `passed=true, owed=false`. One opportunistic candidate deferred to `2026-09-04-codex-implement-review-contract.md` |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 3.2 Operation classes, § 4 (on-failure → never), § 5 item 4
- Intent: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md)
