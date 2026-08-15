# StatusLine Config v2: New JSON Fields + Segments

> **Created**: 2026-03-20
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md Section 11](../2-tech-spec.md#11-v2-update-new-json-fields--segments)

## Background

Claude Code 2.1.80+ statusline JSON schema added 15 new entries (11 top-level + 4 sub-fields) including `context_window.current_usage`, `agent.name`, and `worktree.*`. Our skill's `json-schema.md` is outdated and SKILL.md lacks segments for these fields.

## Requirements

- Sync `references/json-schema.md` with official Claude Code statusline JSON schema
- Add 3 new conditional segments: Token Usage, Agent, Worktree
- Update SKILL.md script rules, examples, and verification JSON
- Follow design decisions from brainstorm equilibrium (threadId: `019d094a-f297-7852-905d-507df678e1f5`)

## Scope

| Scope | Description |
|-------|-------------|
| In | `json-schema.md` rewrite, `SKILL.md` segment/rules/examples update, verification JSON update |
| Out | `themes.md` changes (full reuse strategy), rate_limits support (not in official schema), bright red change (separate PR) |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/statusline-config/references/json-schema.md` | Rewrite | Add 15 new field entries, restructure with grouping |
| `skills/statusline-config/SKILL.md` | Modify | +3 segments, +script rules, +examples, +verification JSON |
| `skills/statusline-config/references/themes.md` | No change | Full reuse strategy (D2 decision) |
| `docs/features/statusline-config/2-tech-spec.md` | Updated | v2 section added (Section 11) |

## Acceptance Criteria

- [x] `json-schema.md` documents all 15 new entries with types, descriptions, and null handling
- [x] SKILL.md Segments table includes Token Usage, Agent, Worktree with correct conditions
- [x] SKILL.md Script Rules includes token format (`%.1fk`), sanitization, and worktree replace rule
- [x] SKILL.md Example Output shows v2 normal mode and worktree mode
- [x] Verification JSON includes `current_usage`, `agent`, and `worktree` fields
- [x] Existing v1 segments and behavior remain unchanged (backward compatible)
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Deep research + best-practices audit completed |
| Design | Done | Brainstorm equilibrium reached (4 decisions) |
| Tech Spec | Done | Section 11 added, 3-round Codex review passed |
| Development | In Progress | `references/json-schema.md` documents the v2 fields; SKILL.md carries the Token Usage / Agent / Worktree segments, script rules and examples |
| Testing | - | |
| Acceptance | In Progress | 6/7 AC verified against the repo (batch `--update-all`, 2026-08-15); the `/codex-review-doc` gate has no recorded run |

## References

- Tech Spec v2: [Section 11](../2-tech-spec.md#11-v2-update-new-json-fields--segments)
- Feasibility Study: [0-feasibility-study-quota-display.md](../0-feasibility-study-quota-display.md)
- Brainstorm threadId: `019d094a-f297-7852-905d-507df678e1f5`
- Doc Review threadId: `019d0953-b1f0-7553-a775-2dd8b124d759`
- Official Docs: [code.claude.com/docs/en/statusline](https://code.claude.com/docs/en/statusline)
