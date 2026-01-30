# {PROJECT_NAME}

## Required Checks (Stop Hook enforced)

| Change Type | Must Run | Can Skip |
|-------------|----------|----------|
| `.ts/.js` code | `/codex-review-fast` -> `/precommit` | - |
| `.md` docs | `/codex-review-doc` | `/codex-review-fast` |
| Comments only | - | All |

Before PR: `/pr-review`

## Workflow

```
Feature: develop -> write tests -> /verify -> /codex-review-fast + /codex-test-review -> /precommit -> /pr-review
Bug fix: /issue-analyze -> /bug-fix -> investigate -> fix -> regression test -> /verify -> /codex-review-fast -> /precommit
```

### Auto-Loop Rule

**Fix -> re-review -> fail -> fix -> ... -> Pass -> next step** (see @rules/auto-loop.md)

## Test Requirements

| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New Service/Provider | `test/unit/` required | `src/service/xxx.ts` -> `test/unit/service/xxx.test.ts` |
| Modify existing logic | Existing pass + new logic | `src/provider/*.ts` -> `test/unit/provider/*.test.ts` |
| Bug fix | Regression test | - |
| New API endpoint | Unit + Integration | `src/controller/*.ts` -> `test/integration/controller/*.test.ts` |

Coverage: happy path + error handling + edge cases (null, empty, extremes)

## Command Quick Reference

| Command | Description | When |
|---------|-------------|------|
| `/codex-brainstorm` | Adversarial brainstorm | Exploration |
| `/feasibility-study` | Feasibility analysis | Requirements |
| `/tech-spec` | Generate tech spec | Design |
| `/review-spec` | Review tech spec | Design |
| `/deep-analyze` | Deep analysis + roadmap | Design |
| `/project-brief` | PM/CTO executive summary | Design |
| `/codex-architect` | Architecture advice | Design |
| `/codex-implement` | Codex writes code | Development |
| `/bug-fix` | Bug fix workflow | Bug fixing |
| `/feature-dev` | Feature development | Development |
| `/code-explore` | Code exploration | Understanding |
| `/git-investigate` | Track code history | Finding source |
| `/issue-analyze` | Issue deep analysis | Root cause |
| `/repo-intake` | One-time project scan | Onboarding |
| `/verify` | Run tests | Development |
| `/codex-review-fast` | Quick review (diff) | **Required** |
| `/codex-review` | Full review (lint+build) | Important PR |
| `/codex-review-branch` | Full branch review | Important PR |
| `/codex-cli-review` | CLI review (full disk) | Deep review |
| `/codex-review-doc` | Review .md files | Doc changes |
| `/codex-explain` | Explain complex code | Understanding |
| `/precommit` | lint + typecheck + test | **Required** |
| `/precommit-fast` | lint + test (no build) | Quick check |
| `/codex-security` | OWASP Top 10 | Security-sensitive |
| `/codex-test-gen` | Generate unit tests | Adding tests |
| `/codex-test-review` | Review test coverage | **Required** |
| `/post-dev-test` | Post-dev test completion | After feature |
| `/check-coverage` | Test coverage analysis | Quality |
| `/dep-audit` | npm vulnerability audit | Periodic / PR |
| `/update-docs` | Sync docs with code | Doc changes |
| `/doc-refactor` | Simplify documents | Doc changes |
| `/create-request` | Create/update request docs | Planning |
| `/create-skill` | Create new skills | Tooling |
| `/simplify` | Code simplification | Refactoring |
| `/de-ai-flavor` | Remove AI artifacts | Doc changes |
| `/zh-tw` | Rewrite in Traditional Chinese | i18n |
| `/project-setup` | Auto-detect and configure project | Onboarding |
| `/pr-review` | PR self-review checklist | Before PR |

## Development Rules

1. **Reference existing code** -- find similar files first, keep style consistent
2. **Test command** -- `{TEST_COMMAND}`
3. **Author attribution** -- use developer's GitHub username, never AI names
4. **No auto-commit** -- Claude must not run `git add`, `git commit`, `git push`

## Tech Stack

{FRAMEWORK} . TypeScript . {DATABASE} . Redis . Jest

## Key Entrypoints

| File | Purpose |
|------|---------|
| `{CONFIG_FILE}` | DI config |
| `{BOOTSTRAP_FILE}` | Bootstrap entry |

## Footguns

| Problem | Solution |
|---------|----------|
| Circular dependency | Lazy loading getter |
| Provider Scope | `@Scope(Prototype)` |
| TEST_ENV | Must set `unit`/`integration`/`e2e` |

## Customization

Replace these placeholders with your project values:

| Placeholder | Your Value |
|-------------|------------|
| `{PROJECT_NAME}` | Your project name |
| `{FRAMEWORK}` | MidwayJS 3.x / NestJS / Express |
| `{CONFIG_FILE}` | src/configuration.ts |
| `{BOOTSTRAP_FILE}` | bootstrap.js |
| `{DATABASE}` | MongoDB / PostgreSQL |
| `{TEST_COMMAND}` | yarn test:unit |
| `{LINT_FIX_COMMAND}` | yarn lint:fix |
| `{BUILD_COMMAND}` | yarn build |
| `{TYPECHECK_COMMAND}` | yarn typecheck |

## Rules

- @rules/auto-loop.md -- Auto review loop (highest priority)
- @rules/fix-all-issues.md -- Zero tolerance
- @rules/testing.md
- @rules/framework.md
- @rules/security.md
- @rules/docs-writing.md
- @rules/docs-numbering.md
- @rules/git-workflow.md
- @rules/logging.md
