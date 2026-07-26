# Self-Improvement Loop

**Corrected on something that can recur → write it down → stop repeating it.**

## When to record

| Trigger | Action |
|---------|--------|
| User corrects a mistake **that can recur** | Append a lesson to the log |
| Same pattern 3+ times | Promote it to a rule in `rules/`, mark the lesson promoted |
| User asks to consolidate | Merge duplicates, archive anything a rule now covers |

A one-off — a typo, a path wrong just this once — is not a lesson. Ask whether the same situation could produce the same error again; if not, skip it and say why. Being corrected on a *recurring* pattern and not recording it is the failure this rule exists to prevent.

## Lesson format

The log is `.claude/sd0x-dev-flow-lessons.md` — namespaced so it cannot collide with another plugin's, created on the first recurring correction, never inside `CLAUDE.md`. Tell the user which number you wrote.

```markdown
### L<number> — <brief description>

- **Context**: What situation led to the mistake
- **Error pattern**: What was done (or not done) incorrectly
- **Correct approach**: What to do instead
- **Prevention**: The detection signal or automation that would catch it next time
- **Source**: <date> — <topic summary, redacted>
```

**Prevention is the field that earns the entry.** "Be careful with X" is not a lesson — name the signal you would notice, or the check that would fail.

## Redaction

Keep dates, file paths, function names, error types, topic summaries. Never record tokens, keys, passwords, internal URLs with credentials, personal data, or stack traces carrying secrets (per @rules/security.md).

Example source line: `2026-02-24 — Deleted rules/docs-writing.md instead of .claude/rules/docs-writing.md during duplicate cleanup`

## Management

| Rule | Detail |
|------|--------|
| Max 20 active lessons | Active = not promoted, not archived. Over that, consolidate before adding |
| Promotion path | Lesson → `.claude/rules/` for this project → plugin core only with cross-project evidence (3+ projects, via issues/PRs) |
| After consolidating | Run `/codex-review-doc` on the log |
| Version control | The user's call. Untracked = personal memory; tracked = shared team memory. `.gitignore` accordingly |

Complementary to @rules/fix-all-issues.md: that rule repairs the defect now, this one records why it happened so the class stops recurring. Neither affects the review loop.
