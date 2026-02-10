---
description: Research current code state then update corresponding docs, ensuring docs stay in sync with code.
argument-hint: <docs-path | feature-keyword>
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(ls:*), Bash(git:*), Bash(find:*)
---

## Auto-Trigger

Auto-triggered after precommit Pass, only when the change maps to a feature under `docs/features/` (see @rules/auto-loop.md Doc Sync Note). Can also be invoked manually.

## Context

- Goal: Update docs based on current code state, ensuring docs stay in sync with implementation.
- Input: Document path (e.g. `docs/features/auth`) or feature keyword (e.g. `auth`)

## Task

### Step 1: Locate Docs and Related Code (3-Level Fallback)

**Key principle: can't find target → `## Gate: ⚠️ Need Human` — don't guess.**

| Level | Method | How |
|-------|--------|-----|
| 1. Context inference | feature-dev parameter or conversation feature name | Extract feature keyword from current context |
| 2. Git diff inference | `git merge-base` + changed paths | Match changed `src/` paths against `docs/features/` directories |
| 3. Not found | Stop and ask | Output `## Gate: ⚠️ Need Human` — do not guess or create new docs |

```bash
# Level 1: If document path provided
ls $ARGUMENTS 2>/dev/null

# Level 1: If keyword, search related docs
find docs -name "*.md" | xargs grep -l "<keyword>" 2>/dev/null

# Level 2: Git diff inference
git diff --name-only $(git merge-base HEAD main)..HEAD -- src/ | head -20
# Match changed src/ paths against docs/features/ directories
ls docs/features/ 2>/dev/null
```

Extract from docs:

- Feature scope described in the document
- Involved Service / Provider / Entity

### Step 2: Research Current Code State

```bash
# Check related source code
ls src/service/ | grep -i "<keyword>"
ls src/provider/ | grep -i "<keyword>"
ls src/entity/ | grep -i "<keyword>"

# Check recent changes
git log --oneline -20 --all -- "src/**/*<keyword>*"
git diff HEAD~10 --stat -- "src/**/*<keyword>*"
```

Key research items:

- [ ] Any new Service / Method added?
- [ ] Any modified logic?
- [ ] Any new Entity / Field added?
- [ ] Any API changes?

### Step 3: Compare Docs vs Code Differences

| Item       | Doc Description | Current Code | Status         |
| ---------- | --------------- | ------------ | -------------- |
| Service    | ...             | ...          | ✅/⚠️ Outdated |
| API        | ...             | ...          | ✅/⚠️ Outdated |
| Data Model | ...             | ...          | ✅/⚠️ Outdated |
| Flow Chart | ...             | ...          | ✅/⚠️ Outdated |
| Test Paths | ...             | ...          | ✅/⚠️ Outdated |

### Step 4: Update Docs

Update document content based on differences:

1. **Architecture diagrams**: If changed, update Mermaid sequenceDiagram / flowchart
2. **Core service table**: Added/removed/renamed Services
3. **API description**: Added/modified API endpoints
4. **Data model**: Added/modified Entity / Field
5. **Test paths**: Update test file paths

### Step 5: Produce Change Summary

## Output

```markdown
# Document Update Report

## Update Scope

- Document path: $ARGUMENTS
- Research time: <timestamp>

## Research Findings

### Code Changes

| Change Type | File           | Description |
| ----------- | -------------- | ----------- |
| Added       | src/service/.. | ...         |
| Modified    | src/entity/... | New field   |

### Document Differences

| Item       | Before   | After    |
| ---------- | -------- | -------- |
| Service    | A, B     | A, B, C  |
| API        | /v1/...  | /v2/...  |
| Test Paths | test/... | test/... |

## Updated Content

<specific document change diff>

## Suggested Follow-ups

- [ ] <items needing further updates>
```

## Safety Valve

Before doc sync, snapshot the full code diff hash. After doc sync, compare to detect any code change (new files or additional hunks in existing files):

```bash
# Before doc sync: hash the full code diff content
PRE_HASH=$(git diff -- '*.ts' '*.js' '*.tsx' '*.jsx' | md5sum | cut -d' ' -f1)

# ... run /update-docs + /create-request --update ...

# After doc sync: compare diff hash
POST_HASH=$(git diff -- '*.ts' '*.js' '*.tsx' '*.jsx' | md5sum | cut -d' ' -f1)
```

If `PRE_HASH != POST_HASH` (code diff changed during doc sync), return to the review loop (@rules/auto-loop.md). Doc-only changes (`.md`) do not re-trigger the code review loop.

## Usage Examples

```bash
# Update related docs
/update-docs docs/features/auth

# Find and update docs by keyword
/update-docs auth

# Update a specific document
/update-docs docs/features/auth/auth-implementation-architecture.md

# Auto-triggered after precommit Pass (feature-dev workflow)
# Claude auto-detects target via 3-level fallback
```
