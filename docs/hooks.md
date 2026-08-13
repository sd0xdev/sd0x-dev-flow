# Hooks Reference

Since hook-lightweighting (2026-08-13) every review-layer hook is a **reminder**: markdown out,
exit 0 on every path, nothing blocks. The one exception is `pre-edit-guard` — a security guard
(sensitive paths), not workflow enforcement — which still blocks with exit 2.
Verdict state is one slot per plane under `~/.cache/sd0x-dev-flow/state/`,
written only by `node scripts/review-state.js note <plane> <pass|fail>` (the model after a review
ran; the precommit runner on its own conclusive outcome) and read by the state-aware hooks via
`node scripts/review-state.js check` (installed projects resolve `.claude/scripts/review-state.js`
first).

| Hook | Trigger | Purpose |
|------|---------|---------|
| `namespace-hint` | SessionStart | Inject plugin command namespace guidance into Claude context |
| `pre-edit-guard` | Before Edit/Write | Block sensitive-path edits (.env/.git) — security guard, still exits 2. **Requires `jq`**: without it the path cannot be extracted and the guard silently does not fire (fail-open, pinned by `test/hooks/pre-edit-guard.test.js`) |
| `post-edit-format` | After Edit/Write | Auto prettier; the digest change is what re-opens the plane's reminder |
| `post-skill-auto-loop` | After Skill tool | Print the static gate-order reminder (review → precommit → doc-sync) — deliberately state-blind, it reads nothing |
| `stop-guard` | Before stop | Print owed-gate reminders from the state (git fallback when the checker is absent) — never blocks |
| `post-compact-auto-loop` | SessionStart (compact) | Re-inject git baseline (branch + uncommitted files) and the same owed-gate reminders |
| `user-prompt-review-guard` | Before each prompt | Print the `[AUTO_LOOP_STATE]` fact line plus a rule pointer (owed-gate lines are rendered by `stop-guard` and `post-compact-auto-loop`) |

Customization:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOOK_BYPASS` | (unset) | Any non-empty value silences the four reminder hooks (`stop-guard`, `user-prompt-review-guard`, `post-skill-auto-loop`, `post-compact-auto-loop`); `pre-edit-guard`, `post-edit-format` and `namespace-hint` do not read it |
| `HOOK_NO_FORMAT` | (unset) | Set `1` to disable auto-formatting |
| `GUARD_EXTRA_PATTERNS` | (unset) | Regex patterns for extra protected paths (e.g. `src/locales/.*\.json$`) |
| `AUTO_LOOP_CHECK_TIMEOUT` | `10` | Seconds allowed for the `review-state.js check` call inside a hook |

Retired settings: `STOP_GUARD_MODE`, `REVIEW_GUARD_COOLDOWN`, `HOOK_DEBUG` — dead config since
hook-lightweighting; the migration (`scripts/migrate-hook-lightweighting.js`) removes
`STOP_GUARD_MODE` from settings and `/claude-health` flags a leftover as P2.

**Dependencies**: reminder rendering needs `node` (for `review-state.js`; hooks fall back to plain
git facts without it, claiming no verdict). Auto-format requires `prettier`. `pre-edit-guard`
requires `jq` — without it sensitive-path protection is **disabled**, not degraded. Other missing
dependencies degrade gracefully — a reminder hook never fails the tool call it rides on.
