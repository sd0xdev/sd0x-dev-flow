# Frontmatter grant surface: burn down the 50 unjustified grants

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`).
> **Created**: 2026-09-04
> **Status**: Pending
> **Priority**: P2
> **Origin**: Deferred out of work item 5 of the codex-exec-transport feature as **opportunistic
> candidates** (`@rules/scope-discipline.md` § Resident Guard item 6): `origin=pre-existing`,
> `change_relation=independent`, none of them P0 / security / data-integrity, and the envelope is
> `closed` — so they are recorded and deferred rather than admitted. Work item 5's own grant
> surface was **fixed, not listed**: `Bash(codex:*)` is gone from every skill.

## Background

Work item 5 added `test/skills/frontmatter-grants.test.js`, which asks of every skill whether each
`Bash(<cmd>:*)` and `mcp__*` grant in its frontmatter corresponds to a command the skill actually
runs. Evidence is code, never prose: fenced blocks and inline code spans in the skill's own files,
plus one hop into any repo file the skill cites by path — the hop exists because INV-001 puts the
transport command line in exactly one file, so a Codex dispatcher's `node <locator>` is legitimately
not in its own directory.

Running that check across the tree found **49 Bash grants across 22 skills** and **one MCP grant**
that nothing invokes — `KNOWN_UNJUSTIFIED.length` and the count of distinct prefixes before `:` in
that list are the predicate for both numbers. They predate this feature and are causally independent of it, so item 5 pinned
them as an equality-checked inventory (`KNOWN_UNJUSTIFIED`, `KNOWN_UNJUSTIFIED_MCP`) rather than
either fixing them inside an unrelated change or letting the guard pass in silence.

**Equality, not containment**, is what makes the pin safe to defer against: a new unjustified grant
fails because it is not on the list, and a cleaned one fails because the list still claims it. The
inventory can only shrink deliberately.

## Requirements

Decide each entry into exactly one of three dispositions, and remove it from the inventory either
way:

| Disposition | Entries it fits | Action |
|---|---|---|
| **Stale** | The command was removed from the workflow, or never ran there (`remind: cat`, `pr-review: git`, `deep-analyze: git`) | Drop the grant |
| **Real but undocumented** | The skill does run it, in a step written as prose or as a placeholder (`precommit: pnpm` / `npx` — the ecosystem table writes `{pm}`; `install-scripts: cp` / `chmod` / `mkdir`) | Write the command as code in the skill, so the grant is self-evidencing |
| **Delegated** | A thin router whose parent runs it, where the router names no path the checker can follow | Cite the parent file by path, which the one-hop rule already resolves |

The abstracted-ecosystem class is the one to decide first: `precommit`, `precommit-fast`, `verify`
and `test-health` between them hold **14 of the 49** (the entries whose prefix is one of those four
skills), all for one reason — their tables name the tool in a *column* and write the command as
`{pm} lint:fix`, so no literal `pnpm`, `mvn` or `mypy` ever appears as a command. Either those tables
gain one worked invocation per ecosystem, or the checker learns the placeholder as a declared,
closed expansion. Pick one; the choice settles well over a quarter of the inventory in a single
decision, and the rest are individual judgements.

## Scope

| In | Out |
|---|---|
| The 50 pinned entries, the inventory, and any skill text that has to change to justify a grant | Adding new grants; widening any grant; the checker's evidence model (change it only if the `{pm}` decision requires it) |

## Acceptance Criteria

- [ ] Every entry in `KNOWN_UNJUSTIFIED` and `KNOWN_UNJUSTIFIED_MCP` is dispositioned and removed; both lists are empty
- [ ] No grant was widened and none added — `git diff` on the frontmatter lines shows removals and unchanged lines only
- [ ] `test/skills/frontmatter-grants.test.js` passes with empty inventories, and its planted-grant control still fails on a grant nothing runs
- [ ] `npm test` passes
- [ ] Pass `/codex-review-doc` (skill text) and `/codex-review-fast` → `/precommit`

## Notes

`jira: mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql` is the MCP entry, and its own SKILL.md
says why: "Searching Jira issues → v1.1 (deferred)". The grant was added ahead of the feature that
would call it. Dropping it now and re-adding it with that feature is the disposition unless the
maintainer wants the permission staged.
