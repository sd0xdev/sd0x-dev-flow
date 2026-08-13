#!/usr/bin/env bash
# UserPromptSubmit hook: one [AUTO_LOOP_STATE] fact line per prompt. A fact,
# not a nudge — it claims nothing that could be already-done. Markdown out,
# exit 0 on every path. Contract: docs/features/hook-lightweighting/2-tech-spec.md §3.2.

set -euo pipefail

[[ -n "${HOOK_BYPASS:-}" ]] && exit 0

# === Plugin-defers-to-local arbitration ===
# When running as a plugin hook, detect if identical local hook is installed
# and registered in project settings — if so, exit 0 to avoid double-fire.
# Dev-mode bypass: hooks/hooks.json at project root = plugin source repo (skip arbitration).
_SELF_NAME="$(basename "$0")"
# Identity, not filename: `basename "$0"` says WHICH hook this is, never WHICH COPY. Without the
# comparison below the local copy satisfies every condition and defers to ITSELF — both copies
# exit 0 and the hook never runs at all (zero-fire, the opposite of the double-fire this block
# exists to prevent; issue #9). An unresolvable side leaves the guard false and does NOT defer:
# double-fire is visible, zero-fire is silent.
#
# Deferral is decided by ORIGIN, not by path identity. `hooks/hooks.json` registers the plugin copy
# under `${CLAUDE_PLUGIN_ROOT}` while settings register the local one under `$CLAUDE_PROJECT_DIR`,
# so the invoking spelling is what separates them — and it stays separate when `.claude/hooks` is a
# SYMLINK to the plugin's own hooks dir, the case where both copies are one file and a path
# comparison says "I am local" for both, so neither defers and every reminder prints twice.
#
# The origin test is deliberately LEXICAL. `pwd -P` on that symlinked layout resolves the local
# copy INTO the plugin directory, which would make it look like the plugin's and restore the exact
# zero-fire this block was written to fix. The resolved comparison stays as the fallback for hosts
# that do not export CLAUDE_PLUGIN_ROOT, and an invocation matching neither runs rather than defers.
#
# It matches the plugin hooks directory EXACTLY, never a descendant of the plugin root. Every
# `hooks/hooks.json` entry is spelled `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh`, so that one
# directory IS the registered surface, while a `${CLAUDE_PLUGIN_ROOT}/*` prefix also swallows a
# project nested under the plugin root — calling the LOCAL copy the plugin's and deferring it to
# itself, which is zero-fire again. Layouts and failure directions: the request doc, issue #9.
_SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" || _SELF_DIR=""
_LOCAL_DIR="$(cd "${CLAUDE_PROJECT_DIR:-/nonexistent}/.claude/hooks" 2>/dev/null && pwd -P)" || _LOCAL_DIR=""
_IS_PLUGIN_COPY=false
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  case "$(dirname "$0")/" in "${CLAUDE_PLUGIN_ROOT%/}"/hooks/) _IS_PLUGIN_COPY=true ;; esac
elif [[ -n "$_SELF_DIR" && -n "$_LOCAL_DIR" && "$_SELF_DIR" != "$_LOCAL_DIR" ]]; then
  _IS_PLUGIN_COPY=true
fi
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]] \
   && [[ ! -f "${CLAUDE_PROJECT_DIR}/hooks/hooks.json" ]] \
   && [[ "$_IS_PLUGIN_COPY" == "true" ]] \
   && [[ -x "${_LOCAL_DIR}/${_SELF_NAME}" ]]; then
  _SETTINGS_MATCH=false
  for _sf in "${CLAUDE_PROJECT_DIR}/.claude/settings.json" \
             "${CLAUDE_PROJECT_DIR}/.claude/settings.local.json"; do
    if [[ -f "$_sf" ]]; then
      if command -v jq &>/dev/null; then
        jq -e '.hooks // {} | .. | strings | select(contains(".claude/hooks/'"${_SELF_NAME}"'"))' "$_sf" >/dev/null 2>&1 \
          && _SETTINGS_MATCH=true && break
      else
        grep -q "\.claude/hooks/${_SELF_NAME}" "$_sf" 2>/dev/null \
          && _SETTINGS_MATCH=true && break
      fi
    fi
  done
  if [[ "$_SETTINGS_MATCH" == "true" ]]; then
    exit 0  # Defer to local hook
  fi
fi

cat >/dev/null 2>&1 || true  # drain stdin; nothing in it is inspected

_CHECKER=""
[[ -n "$_SELF_DIR" && -f "$_SELF_DIR/../scripts/review-state.js" ]] && _CHECKER="$_SELF_DIR/../scripts/review-state.js"
[[ -z "$_CHECKER" && -n "${CLAUDE_PROJECT_DIR:-}" && -f "${CLAUDE_PROJECT_DIR}/.claude/scripts/review-state.js" ]] \
  && _CHECKER="${CLAUDE_PROJECT_DIR}/.claude/scripts/review-state.js"

# Bounded checker (timeout/gtimeout/perl ladder; none present → git fallback).
_OUT=""; _SOURCE=""
if [[ -n "$_CHECKER" ]] && command -v node >/dev/null 2>&1; then
  _T="${AUTO_LOOP_CHECK_TIMEOUT:-10}"; case "$_T" in '' | *[!0-9]*) _T=10 ;; esac
  [ "$_T" -gt 0 ] || _T=10  # 0 would DISABLE `timeout`/`alarm`, not bound them
  if command -v timeout >/dev/null 2>&1; then
    _OUT=$(timeout "$_T" node "$_CHECKER" check --format=fact 2>/dev/null) && _SOURCE=state || _OUT=""
  elif command -v gtimeout >/dev/null 2>&1; then
    _OUT=$(gtimeout "$_T" node "$_CHECKER" check --format=fact 2>/dev/null) && _SOURCE=state || _OUT=""
  elif command -v perl >/dev/null 2>&1; then
    _OUT=$(perl -e 'alarm shift; exec @ARGV or exit 127' "$_T" node "$_CHECKER" check --format=fact 2>/dev/null) && _SOURCE=state || _OUT=""
  fi
fi

if [[ "$_SOURCE" == "state" && -n "$_OUT" ]]; then
  printf '%s\n' "$_OUT"
  printf '%s\n' "審核義務見 rules/auto-loop.md（提醒層，非強制）"
  exit 0
fi

# Git fallback: change classes only, no verdict claims — source=git_status.
# Unreadable git → print nothing (a fact line over an unread tree would be a
# claim, and this hook only states facts); still exit 0.
_git_clean() ( for v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done; git -C "$PWD" "$@" )
_git_clean rev-parse --git-dir >/dev/null 2>&1 || exit 0
_CODE_DIRTY=false; _DOC_DIRTY=false
_classify() { case "$1" in *.md|*.mdx) _DOC_DIRTY=true ;; *) _CODE_DIRTY=true ;; esac; }
while IFS= read -r -d '' _rec; do
  [[ -n "$_rec" ]] || continue
  _classify "${_rec:3}"
  case "${_rec:0:1}" in R|C) IFS= read -r -d '' _orig && _classify "$_orig" ;; esac
done < <(_git_clean status --porcelain=v1 -z -uall 2>/dev/null || true)

_CHANGE="none"
if [[ "$_CODE_DIRTY" == "true" && "$_DOC_DIRTY" == "true" ]]; then _CHANGE="code,doc"
elif [[ "$_CODE_DIRTY" == "true" ]]; then _CHANGE="code"
elif [[ "$_DOC_DIRTY" == "true" ]]; then _CHANGE="doc"; fi
printf '%s\n' "[AUTO_LOOP_STATE] change=${_CHANGE} source=git_status"
printf '%s\n' "審核義務見 rules/auto-loop.md（提醒層，非強制）"
exit 0
