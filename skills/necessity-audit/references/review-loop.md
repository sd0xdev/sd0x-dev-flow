# Review loop — `--continue`

## When to use

User invokes `/necessity-audit <path> --continue <threadId>` after fixing ⛔ Cut elements or after providing new override justifications.

## Continuation contract (Phase C verdict layer only)

The initial run emits the Codex `threadId` inside the report (`### Debate` section — see `output-template.md`). Users pass that id back via `--continue <threadId>`; **the skill itself writes no persistent state** for continuation (keeps §3.3.3 "Write: None directly" invariant in the tech-spec). On `--continue`, Phase C re-dispatches a **direct** § Resume on that thread (NOT via `/codex-brainstorm`) to extend the **verdict-layer** review. FR-8 (requirements §5) and the CLI contract in `docs/features/necessity-audit/2-tech-spec.md` §3.4 still describe this in the retired MCP reply-tool's terms — that wording is **superseded historical documentation**, not a contract this skill breaks; the `--continue` behaviour it specifies is unchanged, only its carrier is.

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Resume with the user-supplied `threadId` (pulled from the previous run's `### Debate` section); the transport pins the sandbox and approval policy:

<user rationale for revisions>

The spec at <TARGET_PATH> has been revised. Re-evaluate whether the Cut items raised in the previous round are still applicable. Emit updated per-element verdicts using the same format: [VERDICT: Keep|Review|Cut] <id> — <rationale> — Evidence: <file:line|doc:§>.

Did the revisions introduce new necessity concerns?


> **Why not `/codex-brainstorm`?** Phase B debate loop is owned by `/codex-brainstorm`'s own continue mechanism. `--continue` here is a Phase-C-only verdict recheck — a narrower, cheaper operation against the same thread.

No new debate topic is built. Phase A re-runs on the (possibly-updated) target file. Phase C merges the new § Resume response with the fresh Phase-A.

## State

The skill is stateless with respect to continuation: no state file is written by `/necessity-audit` itself. The Codex thread is the only persistence mechanism, and it lives inside the Codex exec thread. Users find the `threadId` in the previous run's `### Debate` block and supply it on the next invocation.

> **Why not a local cache?** Writing a local state file would create a second source of truth and conflict with `2-tech-spec.md §3.3.3` ("Write: None directly"). The doc-review verdict already has its home — the reminder state the model notes via `review-state.js` (hook-lightweighting § 3.2) — and this skill's audit verdict is not a doc-review verdict, so it adds no sibling state.

## Termination

| State | Action |
|-------|--------|
| Gate flips to `✅ Audit Clear` | Continue to next lifecycle step (e.g., `/codex-review-doc`) |
| Gate still `⛔` after 3 continues | `⚠️ Need Human` — surface to user, stop auto-loop |
| User overrides all Cut | Gate flips; log `user_override` entries in report |
