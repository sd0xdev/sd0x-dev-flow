# Per-Ecosystem Runner Templates

## Node.js Template

Used for `node-npm`, `node-yarn`, `node-pnpm` template IDs.

### Structure

```javascript
#!/usr/bin/env node
/**
 * @generated_at ${TIMESTAMP}
 * @plugin_version ${VERSION}
 * @template ${TEMPLATE_ID}
 * @ecosystem node
 */
const { execSync } = require('child_process');

const pm = '${PM}'; // npm | yarn | pnpm

// Steps: lint:fix → build → test
const steps = [
  { name: 'lint', cmd: pm, args: ['run', 'lint:fix'], skip: ${HAS_LINT} },
  { name: 'build', cmd: pm, args: ['run', 'build'], skip: ${HAS_BUILD} },
  { name: 'test', cmd: pm, args: ['${TEST_SCRIPT}'], skip: false },
];
```

### Customization Points

| Variable | Source | Default |
|----------|--------|---------|
| `PM` | Lock file detection | `npm` |
| `HAS_LINT` | `package.json` scripts has `lint:fix` | `false` |
| `HAS_BUILD` | `package.json` scripts has `build` | `false` |
| `TEST_SCRIPT` | Best available: `test:ci` > `test` > `test:fast` | `test` |

## Python Template

Template ID: `python`

```bash
#!/bin/bash
# @generated_at ${TIMESTAMP}
# @plugin_version ${VERSION}
# @template python
# @ecosystem python

set -euo pipefail

echo "# precommit runner (python)"

# lint
if command -v ruff &>/dev/null; then
  echo "> ruff check --fix ."
  ruff check --fix . || true
fi

# test
if [ -f "pyproject.toml" ] && grep -q "pytest" pyproject.toml 2>/dev/null; then
  echo "> pytest tests/"
  pytest tests/ -q
elif [ -d "tests" ]; then
  echo "> python -m pytest tests/"
  python -m pytest tests/ -q
fi
```

## Rust Template

Template ID: `rust`

```bash
#!/bin/bash
# @generated_at ${TIMESTAMP}
# @plugin_version ${VERSION}
# @template rust
# @ecosystem rust

set -euo pipefail

echo "# precommit runner (rust)"

# lint
echo "> cargo clippy --fix --allow-dirty"
cargo clippy --fix --allow-dirty 2>/dev/null || true

# build
echo "> cargo build"
cargo build

# test
echo "> cargo test"
cargo test
```

## Go Template

Template ID: `go`

```bash
#!/bin/bash
# @generated_at ${TIMESTAMP}
# @plugin_version ${VERSION}
# @template go
# @ecosystem go

set -euo pipefail

echo "# precommit runner (go)"

# lint
if command -v golangci-lint &>/dev/null; then
  echo "> golangci-lint run --fix"
  golangci-lint run --fix || true
fi

# build
echo "> go build ./..."
go build ./...

# test
echo "> go test ./..."
go test ./...
```

## Eject Header Contract

All templates MUST include these metadata fields in a comment header:

| Field | Format | Required |
|-------|--------|----------|
| `@generated_at` | ISO 8601 timestamp | Yes |
| `@plugin_version` | semver from plugin.json | Yes |
| `@template` | Template ID (e.g., `node-yarn`) | Yes |
| `@ecosystem` | Ecosystem name | Yes |

The header signals that the file was generated and is user-owned. Plugin auto-install (`/project-setup`, `/precommit`) will NOT overwrite files with this header.
