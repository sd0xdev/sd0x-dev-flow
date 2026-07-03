#!/usr/bin/env bash
# emit-plan-gate.sh — Emit a machine-readable PLAN review gate sentinel (plan namespace).
# Consumed by hooks/post-tool-review-state.sh (emit-plan-gate parse branch) to update
# plan_review.* state. Namespace-prefixed (PLAN_REVIEW_GATE) so it can never collide
# with emit-review-gate.sh's REVIEW_GATE (code/doc/aggregate plane).
#
# Usage:
#   bash scripts/emit-plan-gate.sh PENDING [quick|standard|deep]
#   bash scripts/emit-plan-gate.sh READY|BLOCKED|NEEDS_HUMAN|SKIPPED
#   bash scripts/emit-plan-gate.sh DEGRADED [reviewer-unavailable|secret-detected]
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: emit-plan-gate.sh PENDING|READY|BLOCKED|DEGRADED|NEEDS_HUMAN|SKIPPED [tier|reason]" >&2
  exit 1
fi

GATE="$1"
EXTRA="${2:-}"

case "$GATE" in
  PENDING)
    if [[ -n "$EXTRA" ]]; then
      case "$EXTRA" in
        quick|standard|deep) ;;
        *)
          echo "Error: invalid tier '$EXTRA'. Must be quick, standard, or deep." >&2
          exit 1
          ;;
      esac
    fi
    ;;
  DEGRADED)
    if [[ -n "$EXTRA" ]]; then
      case "$EXTRA" in
        reviewer-unavailable|secret-detected) ;;
        *)
          echo "Error: invalid reason '$EXTRA'. Must be reviewer-unavailable or secret-detected." >&2
          exit 1
          ;;
      esac
    fi
    ;;
  READY|BLOCKED|NEEDS_HUMAN|SKIPPED)
    if [[ -n "$EXTRA" ]]; then
      echo "Error: '$GATE' takes no extra argument." >&2
      exit 1
    fi
    ;;
  *)
    echo "Error: invalid gate value '$GATE'. Must be PENDING, READY, BLOCKED, DEGRADED, NEEDS_HUMAN, or SKIPPED." >&2
    exit 1
    ;;
esac

echo "PLAN_REVIEW_GATE=$GATE"
if [[ "$GATE" == "PENDING" && -n "$EXTRA" ]]; then
  echo "PLAN_REVIEW_TIER=$EXTRA"
elif [[ "$GATE" == "DEGRADED" && -n "$EXTRA" ]]; then
  echo "PLAN_REVIEW_REASON=$EXTRA"
fi
