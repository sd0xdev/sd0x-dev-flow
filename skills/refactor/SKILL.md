---
name: refactor
description: "Multi-target refactoring orchestrator. Use when: cleaning up messy code/docs, simplifying code, restructuring documents, batch cleanup. Not for: new features (use feature-dev), bug fixes (use bug-fix), code understanding (use code-explore). Output: refactored code/docs + review gate."
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Skill, AskUserQuestion
---

# Refactor — Multi-Target Refactoring Orchestrator

## Trigger

- Keywords: refactor, cleanup, clean up, simplify code, restructure, tidy up, reduce complexity, batch refactor
- zh-TW: 重構, 整理, 清理, 簡化

## When NOT to Use

| Scenario | Alternative |
|----------|------------|
| New feature development | `/feature-dev` |
| Bug fix | `/bug-fix` |
| Code understanding | `/code-explore` |
| Doc review only | `/codex-review-doc` |
| Single file simplify (known target) | `/simplify` directly |
| Remove AI artifacts (known doc) | `/de-ai-flavor` directly |

## Prohibited Actions

```
❌ git add | git commit | git push — per @rules/git-workflow.md
```

<budget:token_budget>150000</budget:token_budget>

## Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--target <path>` | — | Specific file or directory (repo-relative) |
| `--auto` | — | Auto-detect targets using inline metrics |
| `--max-targets N` | 10 | Maximum targets per run |
| `--mode reference-stability` | — | Narrow pointer-conversion pass (see § Reference-Stability Targets). Requires explicit `--target` files — repeat the flag for multiple files (`--target a.md --target b.js`, ≤ 5); incompatible with `--auto` |

## Workflow

```
Phase 0: Target Detection → Phase 2: Incremental Refactor Loop → Phase 3: Report
(Phase 1: reserved for v2 — parallel exploration)
```

---

## Phase 0: Target Detection & Planning

### `--mode reference-stability` Branch (checked first)

When this mode is passed, Phase 0 takes this branch and **bypasses the generic pipeline
below entirely** — no AI-artifact heuristic, no refactor-catalog classification, and no v2
type skip (the mode accepts any maintained text file its transformation table covers: docs,
code, tests, instruction surfaces — a `*.test.js` target is valid here even though the
generic path skips test files as v2). In code and test files, **only comment and
documentation regions are conversion candidates**: executable strings, assertion
expectations, fixtures, snapshots, generated content, and ordinary data are never touched —
that is INV-005's boundary, and it is what makes skipping the behavioral gate sound (an
eligible **prose-only** comment cannot change runtime behavior — tool-consumed directives and
pragmas such as lint/type-checker directives or source-map metadata are *not* eligible
regions, since comments can carry machine semantics; anything that could change behavior is
out of this mode's reach):

1. Validate each `--target` path (same path-safety rules as below)
2. Enumerate: more than **5** files (after resolving any directory) → `[REFACTOR_BLOCKED] <target>: reference-stability accepts at most 5 enumerated files`
3. Reject `--auto`: `[REFACTOR_BLOCKED] --auto: incompatible with reference-stability`
4. Determine each file's review plane (doc vs code) for step 3 of the mode's loop
5. Proceed to § Reference-Stability Targets — never to the generic code/doc paths

### `--target` Mode

1. **Validate path** (per `references/target-detection.md`):
   - Reject absolute paths (starts with `/`)
   - Reject `..` traversal
   - Reject symlink escape (resolved path outside repo root)
   - Reject non-existent files
   - On rejection: `[REFACTOR_BLOCKED] <path>: <reason>`

2. **Detect file type**:
   - Use extension mapping from `references/target-detection.md`
   - For `.md` files: run AI artifact heuristic (scan for tool names, boilerplate, etc.; 3+ matches → `doc-ai`, else → `doc-structure`)
   - v2 types (config/shell/test): log `[REFACTOR_SKIPPED] {target}: type not yet dispatched (v2)` and skip

3. **Classify refactor types** from `references/refactor-catalog.md` (R01-R09 for v1)

### `--auto` Mode

1. **(Optional) Baseline**: Run `/project-audit` to capture health score
2. **Scan** repo for candidate files (code + doc)
3. **Score** each candidate:

   ```
   score = 0.40 × complexity + 0.35 × change_frequency + 0.25 × isolation
   ```

   - `complexity`: `wc -l <file>` normalized 0-1
   - `change_frequency`: `git log --oneline -- <file> | wc -l` normalized 0-1
   - `isolation`: `1 - (import_count / max_import_count)`
4. **Sort** descending, take top `--max-targets` (default 10)
5. **Classify** each target's file type and refactor types

---

## Phase 2: Incremental Refactor Loop

Process each target in priority order. Budget: max `--max-targets` targets per run.

### Code Targets

```
FOR EACH code target:
  1. /verify fast → capture baseline exit code
     IF baseline exit ≠ 0:
       [REFACTOR_SKIPPED] {target}: baseline failing, cannot verify preservation
       CONTINUE

  2. /simplify {target}

  3. /verify fast → capture post-refactor exit code

  4. Behavioral gate (per references/behavioral-gate.md):
     IF BEHAVIOR_CHANGED (0→non-0):
       [REFACTOR_SKIPPED] {target}: behavioral regression detected
       CONTINUE
     IF NO_TESTS (all steps skipped):
       ⚠️ NO_TESTS: behavioral preservation not verified (advisory, continue)

  5. /codex-review-fast (auto-loop, max 3 rounds)
     IF still blocked:
       [REFACTOR_BLOCKED] {target}: review not passing after max rounds
       CONTINUE

  6. /precommit-fast (lint + test gate, per CLAUDE.md required flow)
     IF ⛔ FAIL:
       [REFACTOR_BLOCKED] {target}: precommit not passing
       CONTINUE

  7. Mark as committable
```

### Doc Targets

Doc targets bypass the behavioral gate entirely — docs have no executable tests.

```
FOR EACH doc target:
  1. Classify: AI artifact heuristic
     IF doc-ai (3+ matches): dispatch /de-ai-flavor {target}
     ELSE (doc-structure): dispatch /doc-refactor {target}

  2. /codex-review-doc (auto-loop, max 3 rounds)
     IF still blocked:
       [REFACTOR_BLOCKED] {target}: review not passing after max rounds
       CONTINUE

  3. Mark as committable
```

### Reference-Stability Targets (`--mode reference-stability`)

A narrow pointer-conversion pass, typically dispatched as the bounded adjustment for an
`ATTENTION_DIFFUSION / REFERENCE_DRIFT` stall (`@skills/codex-code-review/references/loop-diagnostics.md`
§ Attention-Diffusion Subtypes and the Banking Sequence). Its contract is deliberately tighter
than the generic doc/code paths above:

| Rule | Detail |
|------|--------|
| Targets | At most **5** explicitly enumerated files, `--target` only — **never `--auto`**; a directory target only after it resolves to ≤ 5 named files |
| Unit | The *file* is the blast-radius unit: each target gets one complete pass over its **eligible regions** (comments/doc prose — never executable strings, assertions, fixtures, snapshots, or data); the per-file eligible-pointer count is measured and reported before editing, not capped |
| Transformation | Homogeneous only: replace bare `path:line` pointers with `path § heading` (docs), `path` + symbol/function (code), `path` + named test case (tests), or `path` + flag/config key (instruction surfaces). A numeric hint survives only as "around line N" paired with a semantic anchor — never the sole locator (`@rules/docs-writing.md` § Durable References) |
| Forbidden | Unrelated prose cleanup, restructuring, renaming, or de-AI-flavor riding along. A file whose pointers need per-pointer factual reinterpretation is not a stabilization pass — reclassify (`DOC_TOO_LONG` / `UNVERIFIED_CLAIM`) or split by section |
| Exempt content | Point-in-time records (requests, ADRs, review logs), review evidence, scope proofs, and generated report formats keep exact `file:line` — never "updated" |
| Gate | Edits re-open the plane; this mode's internal review/precommit are evidence, **never** the outer terminal verdict. The outer gate is still owed on the whole change afterwards |
| Git | This mode performs no mutating git operation and creates no checkpoint/stash; it may *suggest* the user create a stash/WIP branch first — advisory prose, never a step |

```
FOR EACH reference-stability target (≤ 5):
  1. Measure: count eligible bare path:line pointers (comment/doc regions only), report per file
  2. Convert: homogeneous anchor transformation only
  3. /codex-review-doc or /codex-review-fast per file type (auto-loop, max 3 rounds)
  4. Mark as converted — outer whole-change gate still owed
```

### v2 Targets

```
FOR EACH v2 target (config/shell/test):
  [REFACTOR_SKIPPED] {target}: type not yet dispatched (v2)
  CONTINUE
```

---

## Phase 3: Report & Handoff

### Per-Target Result Table

Output per `references/output-template.md`:

```markdown
| # | Target | Type | Action | Gate | Result |
|---|--------|------|--------|------|--------|
```

### Delta Report (`--auto` only)

If Phase 0 captured `/project-audit` baseline:
1. Run `/project-audit` again
2. Compare dimension scores (before vs after)
3. Output delta table

### User Handoff

Generic refactors: list committable files. Suggest `/smart-commit --execute` (no auto-commit per @rules/git-workflow.md).

**Reference-stability mode has its own handoff — no commit suggestion.** Report each target as
*converted* with its pointer count, state that the **outer whole-change gate remains owed**,
and return control. `/smart-commit --execute` may be offered only after that outer pass is
noted (the banking sequence in `@skills/codex-code-review/references/loop-diagnostics.md`
§ Attention-Diffusion Subtypes and the Banking Sequence); calling converted files
"committable" here would offer the commit before the pass.

---

## Review Loop

**⚠️ Per @rules/auto-loop.md: fix → re-review → ... → ✅ Pass**

| After editing... | Immediately run |
|------------------|----------------|
| Code files | `/codex-review-fast` |
| Doc files | `/codex-review-doc` |

## Verification Checklist

Generic refactors:

- [ ] All code targets passed behavioral gate (`/verify fast` PRESERVED)
- [ ] All targets reviewed (`/codex-review-fast` or `/codex-review-doc`)
- [ ] Skip log complete for all skipped/blocked targets
- [ ] No `git add/commit/push` executed

Reference-stability mode (the behavioral gate does not apply — the mode runs no `/simplify`):

- [ ] Eligible-pointer counts (comment/doc regions only) measured and reported per file before editing
- [ ] Every change is a homogeneous anchor conversion inside an eligible region; no executable strings, assertions, fixtures, snapshots or data touched; no unrelated edits
- [ ] Exempt content (records, review evidence, scope proofs, report formats) untouched
- [ ] Each target reviewed per its plane (`/codex-review-fast` or `/codex-review-doc`)
- [ ] No mutating git operation; no checkpoint/stash created
- [ ] Handoff states the outer whole-change gate is still owed — no commit suggestion

## Examples

```bash
/refactor --target src/utils.ts           # Refactor single code file
/refactor --target docs/guide.md          # Refactor single doc file
/refactor --target src/                   # Refactor all code in directory
/refactor --auto                          # Auto-detect up to 10 targets
/refactor --auto --max-targets 5          # Auto with budget cap
/refactor --mode reference-stability --target docs/features/<feature>/2-tech-spec.md --target scripts/lib/<module>.js
                                          # Pointer conversion only; handoff reports
                                          # "converted; outer gate owed" — no commit suggestion
```
