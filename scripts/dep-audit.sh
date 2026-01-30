#!/usr/bin/env bash
# dep-audit.sh - 依賴安全審計
set -euo pipefail

LEVEL="moderate"  # low | moderate | high | critical
FIX=""

usage() {
  cat <<'EOF'
Usage:
  dep-audit.sh [--level <severity>] [--fix]

Options:
  --level <severity>  最低報告等級 (low|moderate|high|critical)，預設 moderate
  --fix               嘗試自動修復

Examples:
  dep-audit.sh                    # 報告 moderate 以上漏洞
  dep-audit.sh --level high       # 只報告 high/critical
  dep-audit.sh --fix              # 嘗試自動修復
EOF
}

# --- args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --level) LEVEL="${2:-moderate}"; shift 2 ;;
    --fix) FIX="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

# 檢測包管理器
PM="npm"
if [[ -f yarn.lock ]]; then PM="yarn"; fi
if [[ -f pnpm-lock.yaml ]]; then PM="pnpm"; fi

echo "=== DEPENDENCY AUDIT ==="
echo "Package Manager: $PM"
echo "Minimum Level: $LEVEL"
echo ""

# 建立臨時目錄
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
AUDIT_FILE="$TMP_DIR/audit.json"
SUMMARY_FILE="$TMP_DIR/summary.txt"

# 執行審計
echo "[INFO] Running $PM audit..." >&2

set +e
case "$PM" in
  yarn)
    yarn audit --json > "$AUDIT_FILE" 2>/dev/null
    AUDIT_EXIT=$?
    ;;
  pnpm)
    pnpm audit --json > "$AUDIT_FILE" 2>/dev/null
    AUDIT_EXIT=$?
    ;;
  *)
    npm audit --json > "$AUDIT_FILE" 2>/dev/null
    AUDIT_EXIT=$?
    ;;
esac
set -e

# 解析結果
echo "## 審計結果" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

# 統計各等級數量
CRITICAL=0
HIGH=0
MODERATE=0
LOW=0

if [[ -f "$AUDIT_FILE" ]]; then
  # 嘗試解析 npm/yarn audit 的 JSON 格式
  if command -v jq >/dev/null 2>&1; then
    # npm audit 格式
    CRITICAL=$(jq -r '.metadata.vulnerabilities.critical // 0' "$AUDIT_FILE" 2>/dev/null || echo "0")
    HIGH=$(jq -r '.metadata.vulnerabilities.high // 0' "$AUDIT_FILE" 2>/dev/null || echo "0")
    MODERATE=$(jq -r '.metadata.vulnerabilities.moderate // 0' "$AUDIT_FILE" 2>/dev/null || echo "0")
    LOW=$(jq -r '.metadata.vulnerabilities.low // 0' "$AUDIT_FILE" 2>/dev/null || echo "0")

    # yarn audit 格式（可能不同）
    if [[ "$PM" == "yarn" ]]; then
      # yarn audit --json 輸出多行 JSON
      CRITICAL=$(grep -c '"severity":"critical"' "$AUDIT_FILE" 2>/dev/null || echo "0")
      HIGH=$(grep -c '"severity":"high"' "$AUDIT_FILE" 2>/dev/null || echo "0")
      MODERATE=$(grep -c '"severity":"moderate"' "$AUDIT_FILE" 2>/dev/null || echo "0")
      LOW=$(grep -c '"severity":"low"' "$AUDIT_FILE" 2>/dev/null || echo "0")
    fi
  fi
fi

# 輸出摘要表格
echo "| Severity | Count |" >> "$SUMMARY_FILE"
echo "|:---------|------:|" >> "$SUMMARY_FILE"
echo "| Critical | $CRITICAL |" >> "$SUMMARY_FILE"
echo "| High | $HIGH |" >> "$SUMMARY_FILE"
echo "| Moderate | $MODERATE |" >> "$SUMMARY_FILE"
echo "| Low | $LOW |" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

# 計算總數
TOTAL=$((CRITICAL + HIGH + MODERATE + LOW))

# 判斷是否通過
PASS="yes"
case "$LEVEL" in
  critical)
    if [[ $CRITICAL -gt 0 ]]; then PASS="no"; fi
    ;;
  high)
    if [[ $CRITICAL -gt 0 || $HIGH -gt 0 ]]; then PASS="no"; fi
    ;;
  moderate)
    if [[ $CRITICAL -gt 0 || $HIGH -gt 0 || $MODERATE -gt 0 ]]; then PASS="no"; fi
    ;;
  low)
    if [[ $TOTAL -gt 0 ]]; then PASS="no"; fi
    ;;
esac

# 詳細漏洞列表
if [[ $TOTAL -gt 0 ]]; then
  echo "## 漏洞詳情" >> "$SUMMARY_FILE"
  echo "" >> "$SUMMARY_FILE"

  if [[ "$PM" == "yarn" ]]; then
    # 解析 yarn audit 格式
    grep -E '"type":"auditAdvisory"' "$AUDIT_FILE" 2>/dev/null | while read -r line; do
      TITLE=$(echo "$line" | jq -r '.data.advisory.title // "Unknown"' 2>/dev/null || echo "Unknown")
      SEVERITY=$(echo "$line" | jq -r '.data.advisory.severity // "unknown"' 2>/dev/null || echo "unknown")
      MODULE=$(echo "$line" | jq -r '.data.advisory.module_name // "unknown"' 2>/dev/null || echo "unknown")
      URL=$(echo "$line" | jq -r '.data.advisory.url // ""' 2>/dev/null || echo "")

      echo "### [$SEVERITY] $TITLE" >> "$SUMMARY_FILE"
      echo "- **Package**: $MODULE" >> "$SUMMARY_FILE"
      echo "- **URL**: $URL" >> "$SUMMARY_FILE"
      echo "" >> "$SUMMARY_FILE"
    done || true
  else
    # npm audit 格式
    if command -v jq >/dev/null 2>&1; then
      jq -r '.vulnerabilities | to_entries[] | "### [\(.value.severity)] \(.key)\n- **Via**: \(.value.via | if type == "array" then .[0] | if type == "string" then . else .title // "Unknown" end else . end)\n- **Fix**: \(.value.fixAvailable | if type == "boolean" then if . then "Available" else "Not available" end else "Run npm audit fix" end)\n"' "$AUDIT_FILE" 2>/dev/null >> "$SUMMARY_FILE" || true
    fi
  fi
fi

# 輸出結果
cat "$SUMMARY_FILE"

# Gate 判斷
echo ""
echo "## Gate"
echo ""
if [[ "$PASS" == "yes" ]]; then
  echo "✅ **PASS** - 無 $LEVEL 或以上等級漏洞"
else
  echo "❌ **FAIL** - 發現 $LEVEL 或以上等級漏洞"
  echo ""
  echo "### 修復建議"
  echo ""
  echo "\`\`\`bash"
  if [[ "$PM" == "yarn" ]]; then
    echo "yarn upgrade-interactive"
  else
    echo "$PM audit fix"
  fi
  echo "\`\`\`"
fi

# 自動修復
if [[ "$FIX" == "yes" ]]; then
  echo ""
  echo "## 嘗試自動修復"
  echo ""
  set +e
  if [[ "$PM" == "yarn" ]]; then
    echo "[INFO] yarn audit fix is not directly supported, try: yarn upgrade" >&2
    yarn upgrade --pattern "*" 2>&1 | tail -20 || true
  else
    $PM audit fix 2>&1 | tail -20 || true
  fi
  set -e
fi

echo ""
echo "=== END ==="

# 返回適當的退出碼
if [[ "$PASS" == "no" ]]; then
  exit 1
fi
exit 0
