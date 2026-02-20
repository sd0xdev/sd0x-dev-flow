#!/usr/bin/env bash
# SessionStart hook: inject namespace guidance into Claude context
echo "Plugin sd0x-dev-flow: all /command references should be invoked as /sd0x-dev-flow:command"
echo "Plugin scripts: use 'bash scripts/run-skill.sh <skill> <script> [args]' for execution"
