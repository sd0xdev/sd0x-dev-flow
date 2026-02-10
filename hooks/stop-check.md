# Stop Hook - Smart Task Completion Check

Uses a **command type** hook to block Claude from stopping via exit code.

## How It Works

The script `stop-guard.sh` will:

1. Read the conversation transcript
2. Check for code/doc changes
3. Check whether required commands have been executed
4. **Check if reviews passed** (✅ Pass / ⛔ Blocked)
5. **Exit 0** = allow stop, **Exit 2** = block stop

## Check Rules

| Change Type       | Must Execute                        | Additional Check |
| ----------------- | ----------------------------------- | ---------------- |
| `.ts/.js` code    | `/codex-review-fast` + `/precommit` | Review must ✅   |
| `.md` docs        | `/codex-review-doc`                 | Review must ✅   |
| Comments only/none | -                                  | -                |

## Block Conditions

| Condition              | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| Missing required steps | Did not run /codex-review-fast, /precommit, or /codex-review-doc |
| ⛔ Blocked             | Review result is Blocked with no subsequent Pass               |
| 🔴 P0/P1 unresolved   | Has P0/P1 issues with no subsequent Pass                       |

## Pass Markers

The script detects the following pass markers:

- `✅ Pass` / `✅ Ready` / `✅ All pass`
- `Merge Gate.*✅`

## Escalation Marker (behavior-layer, not hook-parsed)

- `⚠️ Need Human` — Doc Sync target not found; requires human intervention. Not blocked by hooks but stops the auto-loop.

## Reference

Follows @CLAUDE.md review loop rules: must re-review after fixes until ✅ PASS
