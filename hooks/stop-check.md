# Stop Hook - Smart Task Completion Check

Uses a **command type** hook to block Claude from stopping via exit code.

## How It Works

The script `stop-guard.sh` will:

1. Read the conversation transcript
2. Check for code/doc changes
3. Check whether required commands have been executed
4. **Check if reviews passed** (gate sentinels below / ⛔ Blocked)
5. **Exit 0** = allow stop, **Exit 2** = block stop

## Check Rules

| Change Type       | Must Execute                        | Additional Check |
| ----------------- | ----------------------------------- | ---------------- |
| code files        | `/codex-review-fast` + `/precommit` | Review must ✅   |
| `.md` docs        | `/codex-review-doc`                 | Review must ✅   |
| No changes        | -                                   | -                |

Comment-only edits are conservatively classified as code: comments can carry compiler/lint/build directives, and no semantic-inertness classifier exists, so an edit to a code file requires the code gates even when only comments changed.

## Block Conditions

| Condition              | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| Missing required steps | Did not run /codex-review-fast, /precommit, or /codex-review-doc |
| ⛔ Blocked             | Review result is Blocked with no subsequent Pass               |
| 🔴 P0/P1 unresolved   | Has P0/P1 issues with no subsequent Pass                       |

## Pass Markers

The canonical sentinels a model should emit (per `rules/auto-loop.md` § Gate Sentinels):

| Gate | Pass sentinel |
|------|---------------|
| Code review | `✅ Ready` |
| Doc review | `✅ Mergeable` |
| Precommit | `## Overall: ✅ PASS` (owns its whole line at column 0) |

The transcript-fallback parser additionally recognizes the structured code-review form `## Gate: ✅` — a parser-supported alias, not a form to emit deliberately.

`✅ All Pass` (and variants like `✅ Pass`) are behaviour-layer prose — no hook classifies them as a verdict, and emitting them satisfies no gate.

## Escalation Marker (behavior-layer, not hook-parsed)

- `⚠️ Need Human` — Doc Sync target not found; requires human intervention. Not blocked by hooks but stops the auto-loop.

## Reference

Follows @CLAUDE.md review loop rules: must re-review after fixes until ✅ PASS
