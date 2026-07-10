# Execute Mode — Runtime Validation & Post-commit Detection

## Runtime Validation

Before each `git commit` in `--execute` mode, validate the sanitized message using a temp file + `validate_msg()`:

```bash
# 1. Write sanitized message to temp file
TMPFILE=$(mktemp "${TMPDIR:-/tmp}/smart-commit-msg.XXXXXX")
trap 'rm -f "$TMPFILE"' EXIT

cat <<'EOF' > "$TMPFILE"
<sanitized commit message from Step 5b>
EOF

# 2. Runtime validation (ERE + \b word boundary — canonical patterns from scripts/commit-msg-guard.sh)
AI_CO_AUTHOR="${AI_CO_AUTHOR:-0}"  # set to 1 when --ai-co-author passed

validate_msg() {
  local tmpfile="$1"
  # Only AI is \b-bounded (keeps bare AI out of "maintainer"/"domain" under -i);
  # GPT/OpenAI stay unbounded to still catch ChatGPT/GPT-4. Canonical source: scripts/commit-msg-guard.sh
  if [ "$AI_CO_AUTHOR" = "1" ]; then
    # Strip the one allowed line, then check for remaining AI patterns
    grep -Eiv '^Co-Authored-By: Claude <noreply@anthropic\.com>$' "$tmpfile" | \
      grep -Ei 'Co-Authored-By:.*(Claude|Anthropic|GPT|OpenAI|Copilot|noreply@anthropic)' && return 1
  else
    grep -Ei 'Co-Authored-By:.*(Claude|Anthropic|GPT|OpenAI|Copilot|noreply@anthropic)' "$tmpfile" && return 1
  fi
  grep -Ei 'Generated (by|with).*(Claude|\bAI\b|GPT|OpenAI|Copilot)' "$tmpfile" && return 1
  grep -Ei '🤖.*(Claude|\bAI\b|GPT|OpenAI)' "$tmpfile" && return 1
  return 0
}

if ! validate_msg "$TMPFILE"; then
  echo "❌ AI content detected after sanitization — aborting commit"
  rm -f "$TMPFILE"
  exit 1  # ABORT: do not proceed to git commit
fi

# 3. Commit using temp file (apply signing flag if specified)
SIGN_FLAG=""
[ "${USE_SIGN:-}" = "1" ] && SIGN_FLAG="-S"
[ "${USE_NO_SIGN:-}" = "1" ] && SIGN_FLAG="--no-gpg-sign"

if [ "$AI_CO_AUTHOR" = "1" ]; then
  ALLOW_AI_COAUTHOR=1 git commit $SIGN_FLAG -F "$TMPFILE"
else
  git commit $SIGN_FLAG -F "$TMPFILE"
fi
rm -f "$TMPFILE"
```

## Post-commit AI Trailer Detection

After each commit in `--execute` mode, scan for forbidden patterns (hard stop on leak):

```bash
git log -1 --format='%B'
```

Scan for the same forbidden patterns from Step 5b. When `--ai-co-author` is active, strip the exact allowed line (`Co-Authored-By: Claude <noreply@anthropic.com>`) before scanning — same logic as `validate_msg()`. If any remaining match is found:

1. **Immediately stop** all remaining commit groups (do NOT continue to next group)
2. Output error with amend guidance:

```
❌ AI attribution leaked in commit <sha>:
   Line: "Co-Authored-By: Claude <noreply@anthropic.com>"
   Remaining commit groups ABORTED.
   To fix: git commit --amend (manual)
   To prevent: /install-scripts commit-msg-guard, then cp .claude/scripts/commit-msg-guard.sh <hooks-path>/commit-msg
```

**Do NOT auto-amend.** Amending is a destructive git operation reserved for the developer.
