#!/usr/bin/env bash
# SessionStart(compact) hook: git context + the same gates-owed nudge as Stop,
# so a compacted session re-reads its ground truth instead of trusting the
# summary. Markdown out, exit 0 on every path.
# Contract: docs/features/hook-lightweighting/2-tech-spec.md §3.2.

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

# Git context: branch + uncommitted file list. Unreadable git → skip silently.
_git_clean() ( for v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done; git -C "$PWD" "$@" )
if _git_clean rev-parse --git-dir >/dev/null 2>&1; then
  _BRANCH=$(_git_clean rev-parse --abbrev-ref HEAD 2>/dev/null) || _BRANCH="(unknown)"
  printf '%s\n' "compaction 後基準重讀：branch=${_BRANCH}"
  _FILES=$(_git_clean status --porcelain=v1 -uall 2>/dev/null | head -20) || _FILES=""
  if [[ -n "$_FILES" ]]; then
    printf '%s\n' "未提交變更（前 20 筆）："
    printf '%s\n' "$_FILES"
  fi
fi

# Same gates-owed nudge as Stop (checker → git fallback), bounded the same way.
_CHECKER=""
[[ -n "$_SELF_DIR" && -f "$_SELF_DIR/../scripts/review-state.js" ]] && _CHECKER="$_SELF_DIR/../scripts/review-state.js"
[[ -z "$_CHECKER" && -n "${CLAUDE_PROJECT_DIR:-}" && -f "${CLAUDE_PROJECT_DIR}/.claude/scripts/review-state.js" ]] \
  && _CHECKER="${CLAUDE_PROJECT_DIR}/.claude/scripts/review-state.js"

_OUT=""; _SOURCE=""
if [[ -n "$_CHECKER" ]] && command -v node >/dev/null 2>&1; then
  _T="${AUTO_LOOP_CHECK_TIMEOUT:-10}"; case "$_T" in '' | *[!0-9]*) _T=10 ;; esac
  [ "$_T" -gt 0 ] || _T=10  # 0 would DISABLE `timeout`/`alarm`, not bound them
  if command -v timeout >/dev/null 2>&1; then
    _OUT=$(timeout "$_T" node "$_CHECKER" check --format=md 2>/dev/null) && _SOURCE=state || _OUT=""
  elif command -v gtimeout >/dev/null 2>&1; then
    _OUT=$(gtimeout "$_T" node "$_CHECKER" check --format=md 2>/dev/null) && _SOURCE=state || _OUT=""
  elif command -v perl >/dev/null 2>&1; then
    _OUT=$(perl -e 'alarm shift; exec @ARGV or exit 127' "$_T" node "$_CHECKER" check --format=md 2>/dev/null) && _SOURCE=state || _OUT=""
  fi
fi

if [[ "$_SOURCE" == "state" ]]; then
  [[ -n "$_OUT" ]] && printf '%s\n' "$_OUT"
  exit 0
fi

_CODE_DIRTY=false; _DOC_DIRTY=false
_classify() { case "$1" in *.md|*.mdx) _DOC_DIRTY=true ;; *) _CODE_DIRTY=true ;; esac; }
while IFS= read -r -d '' _rec; do
  [[ -n "$_rec" ]] || continue
  _classify "${_rec:3}"
  case "${_rec:0:1}" in R|C) IFS= read -r -d '' _orig && _classify "$_orig" ;; esac
done < <(_git_clean status --porcelain=v1 -z -uall 2>/dev/null || true)

[[ "$_CODE_DIRTY" == "true" ]] && printf '%s\n' "📋 code 平面有未提交變更 → /codex-review-fast → /precommit（若本輪已完成對應 review gate，忽略此行即可；規則見 rules/auto-loop.md）"
[[ "$_DOC_DIRTY" == "true" ]] && printf '%s\n' "📋 doc 平面有未提交變更 → /codex-review-doc（若本輪已完成對應 review gate，忽略此行即可；規則見 rules/auto-loop.md）"
exit 0
