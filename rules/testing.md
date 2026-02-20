# Testing Rules

| Type | Directory | Mock |
|------|-----------|------|
| Unit | `test/unit/` (or project convention) | ✅ Any |
| Integration | `test/integration/` | ⚠️ External only |
| E2E | `test/e2e/` | ❌ Forbidden |

Execution: Integration/E2E defaults to running a single file only; use `/verify` to execute
Pre-PR required: `{LINT_FIX_COMMAND} && {TEST_COMMAND}`

Failure report format: `Command: <cmd> | Error: <cause> | Fix: <fix>`
