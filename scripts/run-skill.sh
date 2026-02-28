#!/usr/bin/env bash
# Resolve plugin root from this script's location, then invoke a skill script.
# Usage: bash scripts/run-skill.sh <skill-name> <script-name> [args...]
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
SKILL_NAME="$1"; SCRIPT_NAME="$2"; shift 2

# Validate inputs: reject path traversal (../) and path separators (/)
if [[ "$SKILL_NAME" =~ \.\.|\/ ]] || [[ "$SCRIPT_NAME" =~ \.\.|\/ ]]; then
  echo "Error: invalid skill or script name (path traversal not allowed)" >&2
  exit 1
fi

TARGET="$PLUGIN_ROOT/skills/$SKILL_NAME/scripts/$SCRIPT_NAME"
case "$SCRIPT_NAME" in
  *.js)  exec node "$TARGET" "$@" ;;
  *.sh)  exec bash "$TARGET" "$@" ;;
  *)     exec "$TARGET" "$@" ;;
esac
