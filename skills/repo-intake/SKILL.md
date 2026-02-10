---
name: repo-intake
description: "Project initialization inventory (one-time). Use when: first onboarding a project, rebuilding cache after structural changes. Not for: day-to-day development (read cache directly), finding specific files (use code-explore). Output: project map with entrypoints + test map + next steps."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node:*)
context: fork
agent: Explore
disable-model-invocation: true
---

# Repo Intake

## When to Use

- First time onboarding a project
- Rebuilding cache after major project structural changes
- Cache expired, needs updating

## When NOT to Use

- Already familiar with project structure (read cache directly)
- Only need to find specific files (use Glob/Grep)
- Day-to-day development (cache already exists)

## Workflow

```
Docs -> Entrypoints -> Tests Map -> Next Steps
```

## Usage

```bash
node skills/repo-intake/scripts/intake_cached.js --mode auto --top 10
```

## Cache Location

Cache stored at: `~/.claude/cache/repo-intake/<repoKey>/`

| File          | Description             |
| ------------- | ----------------------- |
| `latest.md`   | Latest scan results     |
| `latest.json` | Latest scan results (JSON) |
| `LATEST.json` | Cache metadata          |

## Output

```markdown
## Overview

<summary>

## Entrypoints

- {CONFIG_FILE}
- {BOOTSTRAP_FILE}

## Test Map

| Type        | Pattern           |
| ----------- | ----------------- |
| Unit        | test/unit/        |
| Integration | test/integration/ |
| E2E         | test/e2e/         |

## Next Steps

- <questions>
```

## Verification

- Output includes Overview, Entrypoints, Test Map, Next Steps
- Entrypoints correctly identify `{CONFIG_FILE}`, `{BOOTSTRAP_FILE}`
- Test Map covers Unit/Integration/E2E layers

## References

- `references/MIDWAY_HEURISTICS.md` — MidwayJS-specific detection heuristics (read when scanning MidwayJS projects)

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/intake_cached.js` | Main intake with caching |
| `scripts/scan_midway_repo.js` | Full MidwayJS repo scanner |
| `scripts/scan_midway_delta.js` | Delta scan for changed files |

## Examples

```
Input: /midway-intake
Action: Execute intake script -> Output project map
```

```
Input: /midway-intake save
Action: Execute intake script -> Output and write to docs/ai/intake/
```
