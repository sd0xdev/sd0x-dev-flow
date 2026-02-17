---
description: Install plugin runner scripts into project .claude/scripts/ for persistent use without plugin loaded
argument-hint: [--all] [--list] [--dry-run] [--force] [script-names...]
allowed-tools: Read, Glob, Write, Bash(mkdir:*), Bash(diff:*), Bash(git:*), Bash(ls:*), Bash(chmod:*), Bash(cp:*)
---

## Context

- Repo root: !`git rev-parse --show-toplevel`
- Existing local scripts: !`ls .claude/scripts/ 2>/dev/null || echo "(none)"`

## Task

Install sd0x-dev-flow plugin runner scripts into the current project's `.claude/scripts/` directory so they persist even without the plugin loaded. These scripts are used by `/precommit`, `/precommit-fast`, `/verify`, and `/dep-audit`.

### Workflow

```mermaid
sequenceDiagram
    participant C as Claude
    participant P as Plugin Scripts
    participant S as .claude/scripts/

    C->>P: Phase 1: Locate plugin scripts dir
    P-->>C: Found
    C->>P: Phase 2: Enumerate scripts
    alt --list
        C-->>C: Output table & stop
    end
    C->>C: Phase 3: Determine install set
    C->>S: Phase 4: Copy scripts + dependencies
    C-->>C: Phase 5: Output report
```

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--all` | Install all available scripts |
| `--list` | List available scripts without installing |
| `--dry-run` | Show what would be installed, no changes |
| `--force` | Overwrite existing scripts with different content |
| `script-names...` | Space-separated script names (without extension) |

### Phase 1: Locate Plugin Scripts Directory

Find the plugin's `scripts/` directory using this priority (short-circuit on first match):

1. **Glob search** — search known Claude plugin locations:

   ```
   Glob: ~/.claude/plugins/**/sd0x-dev-flow/scripts/precommit-runner.js
   Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/scripts/precommit-runner.js
   ```

2. **Plugin-relative fallback** — try reading `@scripts/precommit-runner.js` to confirm accessibility. If readable, derive the scripts directory from the resolved path.
3. **Error** — if no scripts directory found, report error and stop.

### Phase 2: Enumerate Available Scripts

The available scripts and their dependencies are:

| Script | Type | Used By | Dependencies |
|--------|------|---------|--------------|
| `precommit-runner.js` | Node.js | `/precommit`, `/precommit-fast` | `lib/utils.js` |
| `verify-runner.js` | Node.js | `/verify` | `lib/utils.js` |
| `dep-audit.sh` | Bash | `/dep-audit` | None |
| `lib/utils.js` | Node.js (shared) | Required by all `.js` runners | None (Node builtins only) |

If `--list` is specified, output this table and **stop**.

### Phase 3: Determine Installation Set

- `--all`: install all scripts + dependencies
- Specific `script-names`: install those + required dependencies (auto-include `lib/utils.js` when any `.js` runner is selected). Validate names exist in Phase 2 table; error on unknown names.
- Neither: present the list and use AskUserQuestion to let the user select

### Phase 4: Copy Scripts

Use `REPO_ROOT` from `git rev-parse --show-toplevel` for all absolute paths.

If `--dry-run`, compute the install plan without writing any files, output the plan table, and **stop**.

1. Ensure target directories exist:

   ```bash
   mkdir -p ${REPO_ROOT}/.claude/scripts/lib
   ```

2. For each script to install:

   | Scenario | Default | `--force` |
   |----------|---------|-----------|
   | Target does not exist | **Copy** | **Copy** |
   | File exists, content identical | **Skip** (already installed) | **Skip** |
   | File exists, content differs | **Skip** + warn as conflict | **Overwrite** |

3. After copying bash scripts: `chmod +x ${REPO_ROOT}/.claude/scripts/dep-audit.sh`

### Phase 5: Output Report

## Output

```markdown
## Install Scripts Report

**Source**: <plugin-scripts-path>
**Target**: <repo-root>/.claude/scripts/

| Script | Status |
|--------|--------|
| precommit-runner.js | ✅ Copied |
| verify-runner.js | ✅ Copied |
| dep-audit.sh | ✅ Copied |
| lib/utils.js | ✅ Copied |

**Installed**: N / **Skipped**: M / **Conflicts**: K

### Next Steps

- Runner scripts are now available at `.claude/scripts/`
- Commands `/precommit`, `/precommit-fast`, `/verify`, `/dep-audit` will auto-detect them
- Use `--force` to upgrade scripts when plugin updates
```

## Examples

```bash
# List available scripts
/install-scripts --list

# Install all scripts
/install-scripts --all

# Install specific scripts only
/install-scripts precommit-runner verify-runner

# Preview what would happen
/install-scripts --all --dry-run

# Force overwrite existing scripts
/install-scripts --all --force
```
