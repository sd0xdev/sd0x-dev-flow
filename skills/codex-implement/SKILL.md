---
name: codex-implement
description: "Implement features via Codex MCP. Use when: writing new code from specs, implementing features, Codex-driven development. Not for: code review (use codex-code-review), architecture advice (use codex-architect). Output: implemented code + review loop."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob, Edit, Write, AskUserQuestion, Skill
---

# Codex Implement Skill

## Trigger

- Keywords: codex implement, implement feature, codex write code, implement from spec

## When NOT to Use

- Architecture advice only (use `/codex-architect`)
- Code review (use `/codex-review-fast`)
- Bug fix (use `/bug-fix`)
- Simple one-line change (edit directly)

## Workflow

```
Parse args → Decompose → Collect context → Iterate items → Review loop → Done
                                              ↕
                                    codex → diff → confirm
                                              ↕
                                    reject/modify → codex-reply
```

### Step 1: Parse & Decompose

**`--spec` provided**: Read spec/request doc, extract individual items.
**Arguments without `--spec`**: Use directly as single item.
**No arguments**: Ask user for requirement, target file, reference files.

Break into **implementation items** — each one logical unit (interface, method, endpoint), implementable in dependency order, small enough for one Codex call.

Present plan before starting:

```
| # | Item              | Target File          | Depends On |
|---|-------------------|----------------------|------------|
| 1 | Define interfaces | src/interface/x.ts   | -          |
| 2 | Core logic        | src/service/x.ts     | 1          |
| 3 | Controller/Route  | src/controller/x.ts  | 2          |

Proceed?
```

### Step 2: Collect Context (Claude, NOT Codex)

Claude researches the codebase before calling Codex:

1. Read `CLAUDE.md` — tech stack, conventions, test commands
2. Read target file (if exists) and context files
3. Search similar implementations
4. Read 2-3 similar files for patterns

Summarize as `PROJECT_CONTEXT` for Codex.

### Step 3: Iterative Implementation

Implement **one item at a time**, in dependency order.

#### 3a: First item — new session

See `references/codex-prompts.md` for the full prompt template.

Call `mcp__codex__codex` with `sandbox: 'workspace-write'`, `approval-policy: 'on-failure'`.

**Save the returned `threadId`.**

#### 3b: Confirm each item

After each Codex call: `git diff` → ask user:

| Choice | Action |
|--------|--------|
| Accept | Proceed to next item (3c) |
| Reject | `git checkout .` affected files, re-attempt (max 2 retries, then ⛔) |
| Modify | `codex-reply` with feedback → loop back to 3b |

#### 3c: Subsequent items — same thread

Use `mcp__codex__codex-reply` with saved `threadId`. See `references/codex-prompts.md`.

Repeat 3b → 3c until all items done.

### Step 4: Final Confirmation

`git diff` full changeset → user confirms.

### Step 5: Review Loop (Codex-in-the-loop)

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

| Step | Command | On fail |
|------|---------|---------|
| 1 | `/codex-review-fast` | `codex-reply` to fix → re-review |
| 2 | `/precommit` | `codex-reply` to fix → re-run |

Issues found → **use same Codex thread to fix** (not manual). See `references/codex-prompts.md` for fix prompt.

Max 3 rounds per step. Still failing → report blocker.

#### Test Requirements

| Change Type | Required Tests |
|-------------|---------------|
| New service/provider | Unit (happy + error + edge) |
| New API endpoint | Unit + integration |
| Modified logic | Existing pass + new logic tests |
| Bug fix scenario | Regression test |

If Codex omitted tests → `codex-reply` to request them.

## Output

```markdown
## Codex Implementation Report

### Implementation Items

| # | Item | Target File | Status |
|---|------|-------------|--------|
| 1 | ...  | ...         | ✅/❌  |

### Change Summary

| File | Operation | Description |
|------|-----------|-------------|
| ...  | Create/Modify | ...     |

### Review Result
<codex-review-fast output>

### Gate
✅ Complete / ⛔ Needs modification
```

## Verification

- [ ] All items implemented and confirmed
- [ ] Tests included for each item
- [ ] `/codex-review-fast` passed
- [ ] `/precommit` passed

## Examples

```
/codex-implement "Add a method to calculate fees"
/codex-implement "Implement wallet service" --spec docs/features/wallet/2-tech-spec.md
/codex-implement "Add getUserBalance method" --target src/service/wallet.service.ts
/codex-implement "Implement cache logic" --target src/service/cache.ts --context src/service/redis.ts
```
