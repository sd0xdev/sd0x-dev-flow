# Codex Verification Prompt Template

Used when `--verify codex` is specified. Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Start.

## Mandatory Fields (per codex-invocation.md)

| Check | Required |
|-------|----------|
| Prompt includes "independently research" section | Yes |
| Prompt includes concrete git/grep/cat commands | Yes |
| Prompt does NOT contain Claude's analysis/conclusions | Yes |

## Template

You are a senior reasoning auditor. Your task is to independently verify
a first-principles briefing against its source document.

## Files to Review

- Source document: ${SOURCE_PATH}
- FP-Brief output: ${OUTPUT_PATH}

## ⚠️ Important: You must independently research the project ⚠️

### Git Exploration (Priority)

1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for source: `git diff HEAD -- ${SOURCE_PATH}`

### Document Reading (Required)

1. Read source document: `cat ${SOURCE_PATH}`
2. Read FP-Brief output: `cat ${OUTPUT_PATH}`

### Project Research

1. Search for modules referenced in the briefing: `grep -r "keyword" skills/ -l | head -10`
2. Verify referenced files exist: `ls <path>`
3. Read related files for context: `cat <file-path> | head -100`

## Verification Dimensions

For each dimension, assess independently — do NOT rely on the briefing's own claims.

### 1. Root Problem Depth

- Does the 5-Why decomposition reach an irreducible truth?
- Or does it stop at a surface-level restatement?

### 2. Assumption Completeness

- Are there assumptions in the source doc NOT captured in the register?
- Look for: implicit constraints, technology assumptions, scope boundaries

### 3. Reasoning Chain Integrity

- Are there logical jumps? (decision without a traced principle)
- Does each decision actually follow from its stated principle?

### 4. Decision Sensitivity Accuracy

- Are there missing assumption→decision links?
- Are impact ratings reasonable?

### 5. Coverage Completeness

- Are there important source sections not reflected in the briefing?
- Are there decisions in the source doc not captured in the reasoning chain?

## Output Format

Produce a Verification Delta table:

| Aspect | Claude Assessment | Codex Assessment | Delta |
|--------|------------------|------------------|-------|
| Root Problem depth | <adequate/shallow> | <your assessment> | <agree/disagree + detail> |
| Missing assumptions | <count or "none"> | <your findings> | <new assumptions found> |
| Reasoning gaps | <count or "none"> | <your findings> | <logical jumps identified> |
| Sensitivity completeness | <complete/partial> | <your assessment> | <missing links> |
| Coverage | <complete/partial> | <your assessment> | <uncovered sections> |

End with a one-line summary: "Verification: CONFIRMED / GAPS_FOUND / NEEDS_REVISION"
