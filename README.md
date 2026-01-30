# sd0x-dev-flow

Development workflow plugin for [Claude Code](https://claude.com/claude-code) with optional Codex MCP integration.

90+ tools covering code review, testing, investigation, security audit, and DevOps automation.

## Requirements

- Claude Code 2.1+
- [Codex MCP](https://github.com/openai/codex) configured (for `/codex-*` commands)

## Install

```bash
# Add marketplace
/plugin marketplace add sd0xdev/sd0x-dev-flow

# Install plugin
/plugin install sd0x-dev-flow@sd0xdev-marketplace
```

## Quick Start

After installing, run `/project-setup` to auto-detect your project environment and configure all placeholders:

```bash
/project-setup
```

This will detect your framework, package manager, database, entrypoints, and script commands, then update `CLAUDE.md` accordingly.

## What's Included

| Category | Count | Examples |
|----------|-------|---------|
| Commands | 36 | `/project-setup`, `/codex-review-fast`, `/verify`, `/bug-fix` |
| Skills | 23 | project-setup, code-explore, code-investigate, codex-brainstorm |
| Agents | 14 | strict-reviewer, verify-app, coverage-analyst |
| Hooks | 5 | auto-format, review state tracking, stop guard |
| Rules | 9 | auto-loop, security, testing, git-workflow |
| Scripts | 3 | precommit runner, verify runner, dep audit |

## Workflow

```mermaid
sequenceDiagram
    participant D as Developer
    participant C as Claude
    participant X as Codex MCP
    participant V as Verify

    D->>C: /project-setup
    C-->>D: CLAUDE.md configured

    D->>C: /repo-intake
    C-->>D: Project map

    D->>D: Write code + tests

    D->>V: /verify
    V-->>D: Pass/Fail + fix suggestions

    D->>X: /codex-review-fast
    X-->>D: P0/P1/P2 + Gate + threadId

    alt Issues found
        D->>D: Fix P0/P1
        D->>X: /codex-review-fast --continue <threadId>
        Note over X: Context preserved
        X-->>D: Verify fix + update Gate
    end

    D->>X: /codex-test-review
    X-->>D: Coverage + suggestions

    D->>C: /precommit
    C-->>D: Gate + ready to commit

    opt PR prep
        D->>C: /pr-review
        C-->>D: Checklist
    end
```

## Commands Reference

### Development

| Command | Description |
|---------|-------------|
| `/project-setup` | Auto-detect and configure project |
| `/repo-intake` | One-time project intake scan |
| `/bug-fix` | Bug/Issue fix workflow |
| `/codex-implement` | Codex writes code |
| `/codex-architect` | Architecture advice (third brain) |
| `/code-explore` | Fast codebase exploration |
| `/git-investigate` | Track code history |
| `/issue-analyze` | Deep issue analysis |
| `/post-dev-test` | Post-dev test completion |

### Review (Codex MCP)

| Command | Description | Loop Support |
|---------|-------------|--------------|
| `/codex-review-fast` | Quick review (diff only) | `--continue <threadId>` |
| `/codex-review` | Full review (lint + build) | `--continue <threadId>` |
| `/codex-review-branch` | Full branch review | - |
| `/codex-cli-review` | CLI review (full disk read) | - |
| `/codex-review-doc` | Document review | `--continue <threadId>` |
| `/codex-security` | OWASP Top 10 audit | `--continue <threadId>` |
| `/codex-test-gen` | Generate unit tests | - |
| `/codex-test-review` | Review test coverage | `--continue <threadId>` |
| `/codex-explain` | Explain complex code | - |

### Verification

| Command | Description |
|---------|-------------|
| `/verify` | lint -> typecheck -> unit -> integration -> e2e |
| `/precommit` | lint:fix -> build -> test:unit |
| `/precommit-fast` | lint:fix -> test:unit |
| `/dep-audit` | npm dependency security audit |

### Planning

| Command | Description |
|---------|-------------|
| `/codex-brainstorm` | Adversarial brainstorm (Nash equilibrium) |
| `/feasibility-study` | Feasibility analysis |
| `/tech-spec` | Generate tech spec |
| `/review-spec` | Review tech spec |
| `/deep-analyze` | Deep analysis + roadmap |
| `/project-brief` | PM/CTO executive summary |

### Documentation & Tooling

| Command | Description |
|---------|-------------|
| `/update-docs` | Sync docs with code |
| `/check-coverage` | Test coverage analysis |
| `/create-request` | Create/update request docs |
| `/doc-refactor` | Simplify documents |
| `/simplify` | Code simplification |
| `/de-ai-flavor` | Remove AI artifacts |
| `/create-skill` | Create new skills |
| `/pr-review` | PR self-review |
| `/zh-tw` | Rewrite in Traditional Chinese |

## Rules

| Rule | Description |
|------|-------------|
| `auto-loop` | Fix -> re-review -> fix -> ... -> Pass (auto cycle) |
| `fix-all-issues` | Zero tolerance: fix every issue found |
| `framework` | Framework-specific conventions (customizable) |
| `testing` | Unit/Integration/E2E isolation |
| `security` | OWASP Top 10 checklist |
| `git-workflow` | Branch naming, commit conventions |
| `docs-writing` | Tables > paragraphs, Mermaid > text |
| `docs-numbering` | Document prefix convention (0-feasibility, 2-spec) |
| `logging` | Structured JSON, no secrets |

## Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `post-edit-format` | After Edit/Write | Auto prettier (only if project has prettier) |
| `post-tool-review-state` | After Edit/Bash | Track review state |
| `pre-edit-guard` | Before Edit/Write | Prevent editing .env/.git |
| `stop-guard` | Before stop | Warn on incomplete reviews (default: warn) |
| `stop-check` | Before stop | Smart task completion check |

### Hook Configuration

Hooks are safe by default. Use environment variables to customize behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `STOP_GUARD_MODE` | `warn` | Set `strict` to block stop on missing review steps |
| `HOOK_NO_FORMAT` | (unset) | Set `1` to disable auto-formatting |
| `HOOK_BYPASS` | (unset) | Set `1` to skip all stop-guard checks |
| `HOOK_DEBUG` | (unset) | Set `1` to output debug info |
| `GUARD_EXTRA_PATTERNS` | (unset) | Regex patterns for extra protected paths (e.g. `src/locales/.*\.json$`) |

**Dependencies**: Hooks require `jq`. Auto-format requires `prettier` installed in the project. Missing dependencies are handled gracefully (hooks skip silently).

## Customization

Run `/project-setup` to auto-detect and configure all placeholders, or manually edit `CLAUDE.md`:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{PROJECT_NAME}` | Your project name | my-app |
| `{FRAMEWORK}` | Your framework | MidwayJS 3.x, NestJS, Express |
| `{CONFIG_FILE}` | Main config file | src/configuration.ts |
| `{BOOTSTRAP_FILE}` | Bootstrap entry | bootstrap.js, main.ts |
| `{DATABASE}` | Database | MongoDB, PostgreSQL |
| `{TEST_COMMAND}` | Test command | yarn test:unit |
| `{LINT_FIX_COMMAND}` | Lint auto-fix | yarn lint:fix |
| `{BUILD_COMMAND}` | Build command | yarn build |
| `{TYPECHECK_COMMAND}` | Type checking | yarn typecheck |

## Architecture

```
Command (entry) -> Skill (capability) -> Agent (environment)
```

- **Commands**: User-triggered via `/...`
- **Skills**: Knowledge bases loaded on demand
- **Agents**: Isolated subagents with specific tools
- **Hooks**: Automated guardrails (format, review state, stop guard)
- **Rules**: Always-on conventions (auto-loaded)

## Contributing

PRs welcome. Please:

1. Follow existing naming conventions (kebab-case)
2. Include `When to Use` / `When NOT to Use` in skills
3. Add `disable-model-invocation: true` for dangerous operations
4. Test with Claude Code before submitting

## License

MIT
