---
name: generate-runner
description: "Generate a customized precommit runner for any ecosystem. Use when: non-Node projects need a runner, eject from generic runner, customize runner for project. Not for: running precommit (use /precommit), installing runner (handled by auto-install). Output: customized runner script with eject header."
allowed-tools: Read, Grep, Glob, Bash(node:*), Bash(chmod:*), Bash(bash:*), Write, AskUserQuestion
---

# Generate Runner

## Trigger

- Keywords: generate runner, create runner, custom runner, eject runner, runner for python, runner for rust, runner for go

## When NOT to Use

| Need | Use Instead |
|------|-------------|
| Run precommit checks | `/precommit` or `/precommit-fast` |
| Install existing runner | `/project-setup` (auto-installs) |
| Configure the shipped runner's lint globs | Check first that the runtime runner has no `@generated_at` header, then edit `.claude/runner-config.json` — and set `lintArgMode` for the same script role, or the globs stay inert (see § Lint Argument Injection) |

## Lint Argument Injection

**Scope: the runners this plugin ships** — `scripts/precommit-runner.js` and
`scripts/verify-runner.js`. What `/precommit`, `/precommit-fast` and `/verify` actually execute is
the runtime copy at `.claude/scripts/*`, installed by `/install-scripts`. A runner **generated** by
this skill is written to the same path but is user-owned: its template does not append lint
arguments, so `lintGlobs` / `lintArgMode` have **no effect** on it. The discriminator is the eject
header (§ Step 4) — all three of `@generated_at`, `@plugin_version`, `@template`, each on its own
line with a value, in the opening comment block. Read the file before configuring it.

**Known limitation.** A project that installed a runner **before** this fix keeps running the old
version, which passes ESLint-only flags into whatever lint script the repo declares — a
file-rewriting non-ESLint linter reads them as paths and edits sources. Fixing the plugin source
does not reach that copy, and detecting it reliably needs per-release provenance, which is
deliberately out of scope. Remedy: **`/install-scripts precommit-runner.js verify-runner.js
--force`**, with `--dry-run` first to read the write set (the installer copies "scripts +
dependencies" without defining the closure, so the dry run is the authoritative list). The runners
are named rather than swept in by `--all`, which would force-overwrite every core script; confirm
`lib/utils.js` — where the fixed runners decide whether to inject — appears in the report.

**The shipped runner appends nothing to your lint script unless you ask it to.** `lintGlobs` alone
does nothing; it needs `lintArgMode` for the same script role.

| Setting | Where | Shape |
|---------|-------|-------|
| `lintArgMode` | `.claude/runner-config.json`, or `package.json` → `sd0x` | `{"lint": "eslint"}` / `{"lint:fix": "none"}` — keyed by **script role**, never a bare string. Accepted values: `"eslint"` and `"none"` |
| `lintGlobs` | same two places | `["src/**/*.{ts,tsx,js,jsx}", …]` — applied only when that role's `lintArgMode` is `"eslint"` |

**Precedence, per role**: `.claude/runner-config.json` first, **first valid value wins**;
`package.json` → `sd0x` is the fallback. An unusable value — a bare string, a value outside
`eslint`/`none`, a non-role-keyed shape — is warned about and falls through rather than latching,
so `"none"` in `.claude` can suppress an opt-in `package.json` declares. (An unreadable
`.claude/runner-config.json` warns via `loadLintGlobs()`; an unreadable `package.json` stays
silent.)

In `package.json`, to inject ESLint's flags and globs into `lint:fix` only:

```json
{ "sd0x": { "lintArgMode": { "lint:fix": "eslint" }, "lintGlobs": ["src/**/*.{ts,js}"] } }
```

`precommit` reads the `lint:fix` role; `verify` reads `lint` — keyed separately because a repo
routinely runs different engines for each (this one runs markdownlint for `lint:fix`).

**Why it is opt-in.** The runner used to inject by default and guess from the script text whether
the recipient was ESLint. markdownlint-cli2 treats every unrecognised argument as a file glob, so
under `--fix` it rewrote JavaScript as Markdown; one run corrupted 71 files in this repo. Four
successive detection grammars each misclassified something, so detection was removed rather than
deepened.

## Workflow

```mermaid
flowchart LR
    A[Detect Ecosystem] --> B[Select Template]
    B --> C[Customize]
    C --> D[Write Runner]
    D --> E[Verify]
```

### Step 1: Detect Ecosystem

Scan project root for manifest files:

| Manifest | Ecosystem | Template ID |
|----------|-----------|-------------|
| `pnpm-lock.yaml` | Node.js (pnpm) | `node-pnpm` |
| `yarn.lock` | Node.js (yarn) | `node-yarn` |
| `package-lock.json` or `package.json` | Node.js (npm) | `node-npm` |
| `pyproject.toml` | Python | `python` |
| `Cargo.toml` | Rust | `rust` |
| `go.mod` | Go | `go` |

If multiple detected, prefer Node.js > Python > Rust > Go. If none detected, ask user.

### Step 2: Select Template

Load template from `references/templates.md` for the detected ecosystem.

### Step 3: Customize

Read project-specific configuration:

| Source | What |
|--------|------|
| `package.json` scripts | Lint command, test command, build command |
| `.claude/runner-config.json` | **Not read for lint configuration.** Neither `lintGlobs` nor `lintArgMode` reaches a generated runner — the template does not append lint arguments at all (§ Lint Argument Injection), so listing either here would present an inert value as a customization input |
| Lock file | Package manager selection |

### Step 4: Write Runner

Write to `.claude/scripts/precommit-runner.js` (Node) or `.claude/scripts/precommit-runner.sh` (non-Node).

> **A non-Node runner is generated for manual invocation, not for `/precommit`.** `/precommit`,
> `/precommit-fast` and `/verify` probe the **`.js`** path only and execute it on existence; none of
> them detects a `.sh` runner today. So a Python, Rust or Go runner generated here is a real,
> working script that those commands will not run — invoke it directly, or keep the ecosystem's
> checks in the shipped runner, which orchestrates pytest/cargo/go as first-class steps
> (`skills/precommit/SKILL.md` § Step 2). Teaching the three commands to detect and order a `.sh`
> runner is a change to runner dispatch, not to this skill, and is not implied by generating one.

Include eject header:

```
@generated_at <ISO 8601>
@plugin_version <current version>
@template <template-id>
@ecosystem <ecosystem>
```

**Conflict handling**: If target file exists, AskUserQuestion with diff preview.

### Step 5: Verify

- File written successfully
- Script is executable (non-Node: `chmod +x`)
- Syntax check, named so it can actually be run: `node --check <path>` for the Node runner, `bash -n <path>` for a shell one

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--ecosystem <name>` | Force ecosystem (skip detection) | auto-detect |
| `--output <path>` | Custom output path | Ecosystem-dependent, per § Step 4: `.claude/scripts/precommit-runner.js` for Node, `.claude/scripts/precommit-runner.sh` otherwise |
| `--force` | Overwrite existing without asking | off |

## Output

```markdown
## Generated Runner

- Ecosystem: <detected>
- Template: <template-id>
- Output: <path>
- Package manager: <pm>

The generated runner is **user-owned** — plugin updates will not overwrite it.
Edit freely to customize for your project.
```

## Verification

- [ ] Ecosystem correctly detected
- [ ] Template matches ecosystem
- [ ] Eject header present with correct metadata
- [ ] Runner script is valid (no syntax errors)
- [ ] Existing file conflict handled (ask or --force)

## References

- Per-ecosystem templates: `references/templates.md`

## Examples

```
Input: /generate-runner
Action: Detect Node.js (yarn) → load node-yarn template → customize → write .claude/scripts/precommit-runner.js

Input: /generate-runner --ecosystem python
Action: Load python template → customize → write .claude/scripts/precommit-runner.sh

Input: /generate-runner --force
Action: Detect ecosystem → overwrite existing runner without asking
```
