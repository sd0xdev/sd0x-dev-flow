---
description: Comprehensive assessment of Unit / Integration / E2E three-layer test coverage, identify gaps and provide actionable recommendations.
argument-hint: <docs-path>
allowed-tools: Read, Grep, Glob, Bash(ls:*), Bash(find:*), Bash(wc:*)
skills: test-review
---

## Context

- You are now a `coverage-analyst` agent.
- Goal: Based on feature documentation, **comprehensively assess Unit / Integration / E2E three-layer test** coverage, identify gaps and provide actionable recommendations.

## Task

### Step 1: Read Feature Documentation

```bash
# Read specified feature docs
cat $ARGUMENTS/*.md 2>/dev/null || cat $ARGUMENTS.md 2>/dev/null || echo "Please confirm the document path"
```

Extract from feature documentation:

- Feature name and objectives
- Involved Service / Provider / Entity
- Core flows and boundary conditions

### Step 2: Identify Related Source Code

Search related source code based on feature documentation:

```bash
# Search related Services
ls src/service/ | grep -i "<keyword>"

# Search related Providers
ls src/provider/ | grep -i "<keyword>"

# Search related Entities
ls src/entity/ | grep -i "<keyword>"
```

Build source code inventory:
| Module Type | File Path | Core Functionality |

### Step 3: Map Test Files

Check whether each source file has corresponding tests:

```bash
# Unit tests
find test/unit -name "*.test.ts" | xargs grep -l "<ServiceName>" 2>/dev/null

# Integration tests
find test/integration -name "*.test.ts" | xargs grep -l "<ServiceName>" 2>/dev/null
```

### Step 4: Analyze Coverage Gaps

For each source file:

1. **Read source**: Identify public methods, important branches, error handling
2. **Read tests**: Identify covered cases
3. **Compare gaps**:
   - Which methods have no tests?
   - Which branches are not covered?
   - Which error scenarios are not tested?

### Step 5: Classify and Recommend

Classify gaps by severity:

- 🔴 Critical: Core logic, data writes, amount calculations
- 🟠 Major: Important branches, error handling
- 🟡 Minor: Edge cases, utility functions
- ⚪ Nice-to-have: Logging, formatting

## Output

```markdown
# Test Coverage Analysis Report

## Feature Overview

- Feature name: <from documentation>
- Documentation path: $ARGUMENTS
- Related modules: <list involved Service/Provider/Entity>

## Current Coverage

| Module | Source Path | Test Path | Coverage Status |
| ------ | ----------- | --------- | --------------- |
| ...    | src/...     | test/...  | ✅/⚠️/❌        |

## Coverage Gaps

### 🔴 Critical

1. **[Gap Description]**
   - Location: `<file:function>`
   - Reason: <why it matters>
   - Suggested test: <test case description>

### 🟠 Major

(if any)

### 🟡 Minor

(if any)

## Recommended New Tests

| Priority | Test Type   | Test Case | Target File          |
| -------- | ----------- | --------- | -------------------- |
| P0       | Unit        | ...       | test/unit/...        |
| P1       | Integration | ...       | test/integration/... |

## Coverage Summary

| Metric     | Status    |
| ---------- | --------- |
| Feature coverage | X/Y (Z%) |
| Happy path | ✅/❌     |
| Error path | ✅/❌     |
| Edge cases | ✅/❌     |

## Next Steps

1. <highest priority test to add>
2. <second priority>
```

## Usage Examples

```bash
/check-coverage docs/features/auth/login-flow
/check-coverage docs/features/auth
```
