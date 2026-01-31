---
description: Project initialization inventory (one-time). Use when first onboarding or after major structural changes.
argument-hint: [save|nosave]
allowed-tools: Bash(git:*), Bash(node:*), Read, Write, Grep, Glob
skills: repo-intake
---

## Task

Project initialization inventory (one-time execution; subsequent runs read from cache).

### Parameters

```
$ARGUMENTS
```

| Parameter | Description                                    |
| --------- | ---------------------------------------------- |
| `save`    | Write to `docs/ai/intake/<date>-intake.md`     |
| No param  | Output only, do not save                       |

### Execution Flow

```bash
# Step 1: Check cache
CACHE_DIR=~/.claude/cache/repo-intake
if [ -f "$CACHE_DIR"/*/LATEST.json ]; then
  echo "ℹ️ Cache exists, will use auto mode (only rescan on changes)"
fi

# Step 2: Run scan
node skills/repo-intake/scripts/intake_cached.js --mode auto --top 10

# Step 3: If save parameter provided, write to docs
# Output to docs/ai/intake/$(date +%F)-intake.md
```

### Execution Guide

Follow the workflow in the skill:

| Phase    | Reference                                   |
| -------- | ------------------------------------------- |
| Workflow | @skills/repo-intake/SKILL.md |

## When to Use

- ✅ First time onboarding a project
- ✅ After major project structure changes
- ✅ Cache expired, needs refresh

## When NOT to Use

- ❌ Daily development (cache already exists)
- ❌ Only need to find specific files (use Glob/Grep)

## Examples

```bash
# Initial inventory
/repo-intake

# Inventory and write to docs
/repo-intake save
```
