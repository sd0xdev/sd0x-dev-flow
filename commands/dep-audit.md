---
description: 審計 npm 依賴安全風險
argument-hint: [--level <severity>] [--fix]
allowed-tools: Bash(yarn audit *), Bash(npm audit *), Bash(bash *), Read
skills: security-review
---

## Arguments

$ARGUMENTS = 可選參數

- `--level <severity>` - 最低報告等級（low/moderate/high/critical），預設 moderate
- `--fix` - 嘗試自動修復

## Task

執行依賴安全審計：

```bash
bash scripts/dep-audit.sh $ARGUMENTS
```

## Examples

```bash
# 報告 moderate 以上漏洞（預設）
/dep-audit

# 只報告 high/critical
/dep-audit --level high

# 嘗試自動修復
/dep-audit --fix
```

## Output

```markdown
## 審計結果

| Severity | Count |
| :------- | ----: |
| Critical |     0 |
| High     |     2 |
| Moderate |     5 |
| Low      |    10 |

## 漏洞詳情

### [high] Prototype Pollution

- **Package**: lodash
- **Fix**: Available

## Gate

✅ **PASS** - 無 moderate 或以上等級漏洞
❌ **FAIL** - 發現 high 等級漏洞
```

## Severity Levels

| Level    | 說明               |
| :------- | :----------------- |
| critical | 最嚴重，需立即修復 |
| high     | 高風險             |
| moderate | 中等風險（預設）   |
| low      | 低風險             |
