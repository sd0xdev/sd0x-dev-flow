---
description: Research current code state then update corresponding docs, ensuring docs stay in sync with code.
argument-hint: <docs-path | feature-keyword>
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(ls:*), Bash(git:*), Bash(find:*)
---

## Context

- Goal: Update docs based on current code state, ensuring docs stay in sync with implementation.
- Input: Document path (e.g. `docs/features/auth`) or feature keyword (e.g. `auth`)

## Task

### Step 1: Locate Docs and Related Code

```bash
# If document path
ls $ARGUMENTS 2>/dev/null

# If keyword, search related docs
find docs -name "*.md" | xargs grep -l "<keyword>" 2>/dev/null
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

## Usage Examples

```bash
# Update related docs
/update-docs docs/features/auth

# Find and update docs by keyword
/update-docs auth

# Update a specific document
/update-docs docs/features/auth/auth-implementation-architecture.md
```
