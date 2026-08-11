#!/usr/bin/env bash
# Shell shim over the resolver entrypoint. Usage: bash scripts/resolve-feature.sh [--feature <key>]
#
# The failure contract lives in ONE place — `scripts/resolve-feature.js` — and this file only
# forwards to it. Two implementations of a fallback payload drift, and the one that drifts is the
# one nobody reads; the shell copy is also the one that cannot be unit-tested without a subshell.
#
# Prefer `node scripts/resolve-feature.js` in skill instructions: the research skills grant
# `Bash(node:*)` and not `Bash(bash:*)`, and a skill that instructs a command its `allowed-tools`
# forbids has an instruction that reads correct and cannot run. Neither permission is universal —
# `/codex-code-review` grants bash and no node at all — so this shim is the entrypoint for `!`
# context blocks and for the callers that grant bash (`/test-health`, `/codex-code-review`).
#
# Output: JSON with fields: key, source, confidence, docs_path, doc_inventory, canonical_docs,
#         the four source sets, scan_error, has_tech_spec, has_requirements, has_requests
# Exit status is the wrapper's. It emits the full shape with scan_error:true and exit 0 for every
# failure it can observe — a nonzero CLI exit, a signal, a truncated write, a payload that is not
# the agreed shape — so "exit 0 always" holds wherever `node` itself ran. It does not hold when the
# interpreter is missing or unexecutable: `exec` then fails and this shim exits nonzero with no
# JSON, which is the one case a caller must still handle.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec node "$SCRIPT_DIR/resolve-feature.js" "$@"
