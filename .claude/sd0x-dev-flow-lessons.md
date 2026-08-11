# sd0x-dev-flow Lessons

Recurring corrections, recorded so the class stops repeating. Format and rules: `@rules/self-improvement.md`.

## Active

### L1 — Re-wrapping a paragraph breaks line-oriented cross-file assertions

- **Context**: `test/skills/scan-error-gate.test.js` asserts that every consumer skill *states* a
  gate, by matching phrases such as `` a non-null `key` is not evidence the sets are complete ``
  against the skill's instruction surface. The check is line-oriented — it reads a document, not a
  reflowed string.
- **Error pattern**: editing the surrounding prose of a `SKILL.md` and re-wrapping the paragraph at
  a different column, so a required phrase ends up split across a newline. The words are all still
  there and the rendered document is identical; the assertion fails. Hit twice: first across four
  `SKILL.md` files at once, then again while rewriting `skills/recap-ask/SKILL.md` step 4b.
- **Correct approach**: when editing a file that a `test/skills/*.test.js` greps for phrases, keep
  the asserted phrase on one physical line and wrap around it. Rewrap the *other* lines instead.
- **Prevention**: the signal is available before the edit —
  `grep -rn "<the file's basename>" test/skills/ test/scripts/` names every test that reads it, and
  the phrase constants are visible in those files. Run it whenever prose in `skills/**`, `rules/**`
  or a shared reference is being reflowed rather than only appended to. The failure mode is
  distinctive on the other side too: an assertion that fails while the change "only reworded
  something" is this, not a broken gate.
- **Source**: 2026-08-11 — r2 doc-review-phasing, `scan_error` consumer-gate assertions.

### L2 — `git checkout <file>` is not an undo for a mutation test

- **Context**: mutation-checking a guard means editing a file, running the suite, and restoring it.
  Every other restore in the session used a `cp` backup taken immediately before the edit; one
  restore reached for `git checkout <file>` instead.
- **Error pattern**: the file carried a whole session's worth of uncommitted work. `git checkout`
  restores it to **HEAD**, not to the pre-mutation state, so it silently discarded the very feature
  being tested — the mutation "passed" because the guard, the gate and the prose were all gone.
  The tell was `# fail 2` where the mutant should have produced `# fail 1`.
- **Correct approach**: `cp <file> /tmp/<name>.bak` before applying the mutant, `cp` back after.
  Never use a VCS command to undo an edit to a file with uncommitted changes.
- **Prevention**: the mutation harness has exactly one restore mechanism and it is the backup copy.
  A restore step that names `git` at all is the signal. Second signal, after the fact: a mutant that
  changes the failure *count* by more than one, or a suite that fails in files the mutant did not
  touch — that is deleted work, not a caught defect.
- **Source**: 2026-08-11 — r2 doc-review-phasing, `skills/recap-ask/SKILL.md` step 4b.
