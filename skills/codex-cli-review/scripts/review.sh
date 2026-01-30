#!/usr/bin/env bash
# codex-cli-review - 使用 codex review CLI 審核未提交變更
set -euo pipefail

BASE_BRANCH=""
TITLE=""
CUSTOM_PROMPT=""

usage() {
  cat <<'EOF'
Usage:
  review.sh [--base <branch>] [--title "<text>"] [--prompt "<text>"]

Options:
  --base <branch>     與指定分支比較（預設：審核未提交變更）
  --title "<text>"    設定審核標題
  --prompt "<text>"   自訂審核指令

Examples:
  review.sh                          # 審核未提交變更
  review.sh --base main              # 與 main 分支比較
  review.sh --title "Feature: User Auth"   # 帶標題審核
EOF
}

# --- 解析參數 ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE_BRANCH="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --prompt) CUSTOM_PROMPT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

# --- 檢查 codex CLI ---
if ! command -v codex >/dev/null 2>&1; then
  echo "[ERROR] codex CLI not found. Install: npm install -g @openai/codex" >&2
  exit 127
fi

# --- 檢查 git 狀態 ---
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[ERROR] Not inside a git repository." >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# --- 檢查是否有變更 ---
if [[ -z "$BASE_BRANCH" ]]; then
  # 檢查未提交變更
  CHANGES=$(git status --porcelain 2>/dev/null)
  if [[ -z "$CHANGES" ]]; then
    echo "[INFO] No uncommitted changes to review." >&2
    exit 0
  fi
  echo "=== CODEX CLI REVIEW (Uncommitted Changes) ==="
else
  # 檢查與 base 分支的差異
  CHANGES=$(git diff --name-only "$BASE_BRANCH"..HEAD 2>/dev/null)
  if [[ -z "$CHANGES" ]]; then
    echo "[INFO] No changes compared to $BASE_BRANCH." >&2
    exit 0
  fi
  echo "=== CODEX CLI REVIEW (vs $BASE_BRANCH) ==="
fi

echo ""
echo "Changed files:"
if [[ -z "$BASE_BRANCH" ]]; then
  git status --short
else
  git diff --name-only "$BASE_BRANCH"..HEAD | head -20
fi
echo ""

# --- 建構 codex review 命令 ---
CMD="codex review"

if [[ -z "$BASE_BRANCH" ]]; then
  CMD="$CMD --uncommitted"
else
  CMD="$CMD --base $BASE_BRANCH"
fi

if [[ -n "$TITLE" ]]; then
  CMD="$CMD --title \"$TITLE\""
fi

# --- 設定 sandbox 權限（允許讀取專案檔案）---
CMD="$CMD -c 'sandbox_permissions=[\"disk-full-read-access\"]'"

echo "[INFO] Running: $CMD"
echo ""

# --- 執行 codex review ---
set +e
if [[ -n "$CUSTOM_PROMPT" ]]; then
  echo "$CUSTOM_PROMPT" | eval "$CMD" -
  CODE=$?
else
  eval "$CMD"
  CODE=$?
fi
set -e

echo ""

if [[ $CODE -ne 0 ]]; then
  echo "[ERROR] codex review failed (exit=$CODE)." >&2
  exit $CODE
fi

echo "=== END ==="
