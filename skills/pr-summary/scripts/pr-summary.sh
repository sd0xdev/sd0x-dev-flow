#!/usr/bin/env bash
# pr-summary.sh — Fetch open PRs, filter, group by ticket, format as Markdown
# Usage: bash pr-summary.sh [--author <user>] [--label <label>] [--output <path>]

set -euo pipefail

AUTHOR=""
LABEL=""
OUTPUT="/tmp/pr-summary.md"
TICKET_PATTERN="${TICKET_PATTERN:-[A-Z]+-[0-9]+}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --author)
      [[ $# -ge 2 ]] || { echo "Error: --author requires a value" >&2; exit 1; }
      AUTHOR="$2"; shift 2 ;;
    --label)
      [[ $# -ge 2 ]] || { echo "Error: --label requires a value" >&2; exit 1; }
      LABEL="$2"; shift 2 ;;
    --output|-o)
      [[ $# -ge 2 ]] || { echo "Error: --output requires a value" >&2; exit 1; }
      OUTPUT="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: pr-summary.sh [--author <user>] [--label <label>] [--output <path>]"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Verify gh CLI
command -v gh &>/dev/null || { echo "{\"error\":\"gh CLI not found\"}" >&2; exit 1; }

# Build gh args
GH_ARGS=(pr list --state open --limit 200)
GH_ARGS+=(--json number,title,url,headRefName,baseRefName,author)
[[ -n "$AUTHOR" ]] && GH_ARGS+=(--author "$AUTHOR")
[[ -n "$LABEL" ]] && GH_ARGS+=(--label "$LABEL")

# Fetch, filter, group, format
RESULT=$(gh "${GH_ARGS[@]}" --jq "
  # 1. Filter automation PRs
  [.[] | select(
    (.headRefName | test(\"^dependabot/\") | not) and
    (.headRefName | test(\"^snyk-\") | not)
  )] |

  # 2. Annotate: extract ticket ID + detect stacked PRs
  # Stacked PRs inherit ticket from base branch if head has none
  [.[] |
    (.baseRefName | test(\"^(main|master|develop)$\") | not) as \$stacked |
    . + {
      ticket: (
        if (.headRefName | test(\"${TICKET_PATTERN}\"))
        then (.headRefName | capture(\"(?<id>${TICKET_PATTERN})\") | .id)
        elif (\$stacked and (.baseRefName | test(\"${TICKET_PATTERN}\")))
        then (.baseRefName | capture(\"(?<id>${TICKET_PATTERN})\") | .id)
        else \"\" end
      ),
      is_stacked: \$stacked
    }
  ] |

  # 3. Early exit if empty
  if length == 0 then \"No open PRs found.\"
  else
    # 4. Group by ticket (no ticket -> unique by url)
    group_by(if .ticket != \"\" then .ticket else .url end) |
    sort_by(-(.[0].ticket | length)) |

    # 5. Format each group
    [.[] |
      # Header
      (if .[0].ticket != \"\" then \"**\" + .[0].ticket + \"**\"
       else \"**\" + .[0].title + \"**\" end) as \$header |

      # Sort: base PRs first, stacked after
      sort_by(.is_stacked) |

      # PR entries
      [.[] |
        .url + \"\n> \" + .title +
        if .is_stacked then \" (stacked on \" + .baseRefName + \")\" else \"\" end
      ] |

      \$header + \"\n\n\" + join(\"\n\n\")
    ] | join(\"\n\n\")
  end
")

# Write output
echo "$RESULT" > "$OUTPUT"

# Summary to stderr
PR_COUNT=$(echo "$RESULT" | grep -c '^https://' || true)
GROUP_COUNT=$(echo "$RESULT" | grep -c '^\*\*' || true)

cat >&2 <<EOF
{
  "status": "ok",
  "pr_count": $PR_COUNT,
  "group_count": $GROUP_COUNT,
  "output": "$OUTPUT"
}
EOF
