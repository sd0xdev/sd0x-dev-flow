---
description: Review technical spec documents from completeness, feasibility, risk, and code consistency perspectives.
argument-hint: <file path>
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node:*)
skills: tech-spec
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- Project structure: !`echo "Run /repo-intake first"`

## Task

You are now a `tech-spec-reviewer` expert. Review the following technical spec document:

### Document to Review

```
$ARGUMENTS
```

### Review Flow

#### Step 1: Read the Technical Spec

Read the specified technical spec document and understand its content.

#### Step 2: Research Related Code

Research actual code based on modules mentioned in the spec:

```bash
# Check if files mentioned in the spec exist
ls -la <file paths mentioned in spec>

# Check actual implementation of related modules
grep -r "related keyword" src/ --include="*.ts" | head -20

# Check existing design patterns
cat src/provider/basic/provider.basic.ts | head -50
```

#### Step 3: Completeness Check

- Are requirements fully covered?
- Are boundary conditions considered?
- Is error handling clearly defined?

#### Step 4: Feasibility Assessment

- Is the technology selection reasonable?
- Is it compatible with existing code?
- Is there a simpler approach?

#### Step 5: Risk Review

- Is risk identification comprehensive?
- Are mitigation plans feasible?
- Are there overlooked risks?

#### Step 6: Code Consistency

- Does it follow the project's Provider/Service/Entity patterns?
- Does naming follow conventions?
- Does it reuse existing utilities?

#### Step 7: Test Strategy

- Is test coverage sufficient?
- Is Unit/Integration/E2E split reasonable?

## Output

```markdown
# Technical Spec Review Report

**Reviewed Document**: `$ARGUMENTS`
**Review Date**: <date>

## Review Summary

| Dimension        | Rating     | Notes |
| ---------------- | ---------- | ----- |
| Completeness     | ⭐⭐⭐⭐☆  |       |
| Feasibility      | ⭐⭐⭐☆☆   |       |
| Risk Assessment  | ⭐⭐⭐⭐☆  |       |
| Code Consistency | ⭐⭐⭐⭐⭐ |       |
| Test Strategy    | ⭐⭐⭐☆☆   |       |

## Overall Verdict

✅ Approved / ⚠️ Needs revision / ❌ Needs redesign

<1-3 sentence summary>

## Strengths

-

## Issues & Recommendations

### 🔴 Must Fix (Blocker)

1. **[Issue Title]**
   - Location: Section X of the spec
   - Issue: Specific description
   - Recommendation: How to fix

### 🟡 Suggested Changes (Improvement)

1. **[Issue Title]**
   - Location:
   - Issue:
   - Recommendation:

### 🟢 Optional Improvements (Nice to have)

1. **[Improvement]**
   - Recommendation:

## Missing Items

(Content that should be in the spec but is not)

## Code Verification Results

(Issues found after comparing with actual code)

## Open Discussion

(Questions requiring further discussion)
```
