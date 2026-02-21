---
name: project-setup
description: "Project configuration initialization. Use when: first-time setup, auto-detecting framework, replacing CLAUDE.md placeholders. Not for: ongoing config checks (use claude-health), skill creation (use create-skill). Output: configured CLAUDE.md + project settings."
allowed-tools: Read, Grep, Glob, Edit, Bash(node:*), Bash(git:*), Bash(ls:*)
# context: shared (default) — intentionally NOT fork because Phase 2 requires user confirmation
---

# Project Setup

## Trigger

- Keywords: project setup, init, initialize, configure project, setup CLAUDE.md, customize placeholders

## When NOT to Use

- CLAUDE.md placeholders are already fully replaced (no `{...}` remaining)
- Non Node.js/TypeScript project without a recognized manifest file -- run with `--detect-only` to see what can be auto-detected. Manual configuration may be needed for: {FRAMEWORK}, {CONFIG_FILE}, {BOOTSTRAP_FILE}. Script commands ({TEST_COMMAND}, etc.) can often be detected from manifest files
- Only want to modify a single placeholder -- just Edit CLAUDE.md directly

## Workflow

```
Phase 1: Detect project environment
    │
    ├─ Read package.json (dependencies, devDependencies, scripts)
    ├─ Detect lockfile (yarn.lock / pnpm-lock.yaml / package-lock.json)
    ├─ Detect entrypoints (glob src/)
    └─ Compile results
    │
Phase 2: Confirm detection results
    │
    ├─ Present detection results table
    └─ Wait for user confirmation or corrections
    │
Phase 3: Write to .claude/CLAUDE.md (unless --detect-only)
    │
    ├─ Read CLAUDE.template.md, filter ecosystem blocks
    └─ Replace placeholders, write to .claude/CLAUDE.md
    │
Phase 4: Verify
    │
    ├─ Read .claude/CLAUDE.md to confirm no remaining placeholders
    └─ Output final summary
```

## Phase 1: Detect Project Environment

Execute the following detections in order; see `references/detection-rules.md` for detailed rules:

### Detection Steps

1. **Detect Ecosystem** — Glob for manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `build.gradle`, `pom.xml`, `Gemfile`). Priority order in `references/detection-rules.md`.
2. **Read manifest** — Extract project name, dependencies, scripts (Node.js: `package.json`; others: ecosystem manifest)
3. **Detect Package Manager** — Lockfile detection (Node.js only): `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, else npm
4. **Detect Framework** — From dependencies. See `references/detection-rules.md#framework`
5. **Detect Database** — From dependencies. See `references/detection-rules.md#database`
6. **Detect Entrypoints** — Glob framework-specific candidates. See `references/detection-rules.md#entrypoints`
7. **Detect Scripts** — From manifest scripts field. See `references/detection-rules.md#scripts`. Missing scripts → `# N/A (no script found)`

For non-Node.js ecosystems, skip Node-specific steps and use ecosystem-specific detection from `references/detection-rules.md`.

## Phase 2: Confirm Detection Results

Present a table of all 9 placeholders with `| Placeholder | Detected Value | Source |` columns.
Wait for user confirmation before proceeding to Phase 3.

## Phase 2.5: Select Ecosystem Blocks

Based on detected manifest (from Phase 1.0):

| Manifest | Ecosystem tag |
|----------|--------------|
| `package.json` | `node-ts` |
| `pyproject.toml` | `python` |
| `go.mod` | `go` |
| `Cargo.toml` | `rust` |
| `Gemfile` | `ruby` |
| `pom.xml` / `build.gradle` | `java` |

## Phase 3: Write to .claude/CLAUDE.md

**Prerequisite**: User has confirmed, and not in `--detect-only` mode.

1. Read `CLAUDE.template.md` (if not found, fallback to `CLAUDE.md`)
2. Remove `<!-- block:X -->...<!-- /block -->` sections NOT matching detected ecosystem
3. Remove remaining block markers (`<!-- block:... -->`, `<!-- /block -->`)
4. Execute `Edit` for each placeholder (using `replace_all: true`)
5. Write to `.claude/CLAUDE.md` (create directory if needed)

If `.claude/CLAUDE.md` does not exist, create it from the rendered template.

## Phase 4: Verify

1. Read `.claude/CLAUDE.md`
2. `Grep: \{[A-Z_]+\}` — confirm no remaining placeholders
3. Output summary table with all placeholder values and remaining count

## Verification

- [ ] All 9 placeholders detected or marked N/A
- [ ] User confirmed detection results before writing
- [ ] No remaining `{UPPER_CASE}` placeholders in `.claude/CLAUDE.md` after setup

## References

See detection rules: [detection-rules.md](./references/detection-rules.md)
