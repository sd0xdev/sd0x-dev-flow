# Testing Rules

| Type        | Directory           | Environment Variable   | Mock             |
| ----------- | ------------------- | ---------------------- | ---------------- |
| Unit        | `test/unit/`        | `TEST_ENV=unit`        | ✅ Any           |
| Integration | `test/integration/` | `TEST_ENV=integration` | ⚠️ External only |
| E2E         | `test/e2e/`         | `TEST_ENV=e2e`         | ❌ Forbidden     |

Execution: Integration/E2E defaults to running a single file only; use `/verify` to execute
Pre-PR required: `{LINT_FIX_COMMAND} && {TYPECHECK_COMMAND} && {TEST_COMMAND}`

Failure report format: `Command: <cmd> | Error: <cause> | Fix: <fix>`
