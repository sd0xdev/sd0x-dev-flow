#!/usr/bin/env bash
# Resolve plugin root from this script's location, then invoke a skill script.
# Usage: bash scripts/run-skill.sh <skill-name> <script-name> [args...]
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
SKILL_NAME="$1"; SCRIPT_NAME="$2"; shift 2
exec node "$PLUGIN_ROOT/skills/$SKILL_NAME/scripts/$SCRIPT_NAME" "$@"
