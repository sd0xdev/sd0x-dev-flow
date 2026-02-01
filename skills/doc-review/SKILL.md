---
name: doc-review
description: Document review knowledge base. Covers tech spec review, document audit, document refactoring. Codex MCP integration for .md reviews.
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
context: fork
agent: Explore
---

# Document Review Skill

## Trigger

- Keywords: review doc, document review, tech spec review, review-spec, doc-refactor, streamline doc

## When NOT to Use

- Code review (use `codex-code-review`)
- Test coverage review (use `test-review`)
- Just want to read a document (use Read directly)

## Commands

| Command             | Description            | Use Case          |
| ------------------- | ---------------------- | ----------------- |
| `/codex-review-doc` | Codex reviews .md docs | Document changes  |
| `/review-spec`      | Review tech spec       | Spec confirmation |
| `/doc-refactor`     | Streamline documents   | Doc too long      |
| `/update-docs`      | Research & update docs | After code change |

## Workflow: `/codex-review-doc`

```
Determine target → Read content → Codex review (5 dimensions) → Rating table + Gate → Loop if Needs revision
```

### Step 1: Determine Target File

| Condition | Action |
|-----------|--------|
| Path specified | Use that path directly |
| No path | Auto-detect: git modified `.md` → staged `.md` → new `.md` |
| Multiple files | List and ask user which to review |

### Step 2: Read File Content

Read target file, save as `FILE_CONTENT`.

### Step 3: Codex Review

**First review**: `mcp__codex__codex` with doc review prompt. See @references/codex-prompt-doc.md.

Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

**Save the returned `threadId`.**

**Loop review**: `mcp__codex__codex-reply` with re-review template. See @references/review-loop-doc.md.

### Step 4: Consolidate Output

Organize results into rating table + severity-grouped findings + gate.

## Review Dimensions

| Dimension           | Checks |
| ------------------- | ------ |
| Architecture Design | System boundaries, responsibilities, dependencies, extensibility |
| Performance         | Bottlenecks, concurrency, caching, resource usage |
| Security            | Data leakage, access control, input validation, error handling |
| Documentation Quality | Structure, completeness, accuracy, examples, docs-writing standards |
| Code Consistency    | Pseudocode matches codebase, referenced files exist, technical accuracy |

## Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

⛔ Needs revision → fix 🔴 items → `/codex-review-doc --continue <threadId>` → repeat until ✅ Mergeable.

Max 3 rounds. Still failing → report blocker.

## Verification

- [ ] Each issue tagged with severity (🔴/🟡/⚪)
- [ ] Gate is clear (✅ Mergeable / ⛔ Needs revision)
- [ ] Codex verified code-documentation consistency independently

## Required Actions

| Change Type | Must Execute                          |
| ----------- | ------------------------------------- |
| `.md` docs  | `/codex-review-doc` or `/review-spec` |
| Tech spec   | `/review-spec`                        |
| README      | `/codex-review-doc`                   |

## References

- Doc review prompt: `references/codex-prompt-doc.md`
- Review loop: `references/review-loop-doc.md`
- Standards: @rules/docs-writing.md

## Examples

```
Input: /codex-review-doc docs/features/xxx/tech-spec.md
Action: Read file → Codex doc prompt → Rating table + Findings + Gate

Input: /codex-review-doc
Action: Auto-detect changed .md → Codex doc prompt → Rating table + Gate

Input: Review this tech spec for me
Action: /review-spec → Check completeness/feasibility/risks → Output Gate

Input: This document is too long, streamline it
Action: /doc-refactor → Tabularize + Mermaid → Output comparison
```
