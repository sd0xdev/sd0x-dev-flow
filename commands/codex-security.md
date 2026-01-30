---
description: 用 Codex MCP 進行 OWASP Top 10 安全專項審查。支援循環審核上下文保持。
argument-hint: [--scope <dir>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
skills: security-review
---

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

你現在要使用 Codex MCP 進行 OWASP Top 10 安全專項審查。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                    | 說明                    |
| ----------------------- | ----------------------- |
| `--scope <dir>`         | 審查範圍（預設 `src/`） |
| `--continue <threadId>` | 繼續之前的審核會話      |

### Step 1: 確定審查範圍

從 $ARGUMENTS 解析 `--scope` 參數，預設為 `src/`。

### Step 2: 收集代碼變更

優先審查最近變更的代碼：

```bash
# 取得未提交的變更
git diff HEAD -- <scope> | head -1500

# 如果沒有變更，取得最近提交的變更
git diff HEAD~5..HEAD -- <scope> | head -1500

# 如果都沒有，掃描關鍵安全相關檔案
Glob("**/*{auth,login,password,token,secret,key,credential}*.ts")
```

將變更內容保存為 `CODE_CHANGES` 變數。

### Step 3: 執行安全審查

**情況 A：首次審核（無 `--continue`）**

使用 `mcp__codex__codex` 工具啟動新審核會話：

```typescript
mcp__codex__codex({
  prompt: `你是資深資安專家。請對以下代碼進行 OWASP Top 10 安全審查。

## 審查範圍
${SCOPE}

## 代碼變更
\`\`\`diff
${CODE_CHANGES}
\`\`\`

## ⚠️ 重要：你必須自主調研專案 ⚠️

安全審查需要理解完整上下文，請主動調研：
- 搜尋認證相關代碼：\`grep -r "auth\\|token\\|session" src/ --include="*.ts" -l | head -10\`
- 查看輸入驗證：\`grep -r "@Body\\|@Query\\|@Param" src/ --include="*.ts" -A 5 | head -50\`
- 檢查敏感操作：\`grep -r "password\\|secret\\|key" src/ --include="*.ts" -l\`
- 讀取相關檔案：\`cat <檔案路徑> | head -100\`

## OWASP Top 10 檢查項目

### A01: Broken Access Control
- IDOR（不安全的直接物件引用）
- 權限繞過
- CORS 配置錯誤

### A02: Cryptographic Failures
- 敏感資料未加密
- 弱加密演算法（MD5、SHA1）
- 硬編碼密鑰

### A03: Injection
- SQL Injection
- NoSQL Injection（MongoDB）
- Command Injection
- XPath/LDAP Injection

### A04: Insecure Design
- 缺少 Rate Limiting
- 業務邏輯漏洞
- 缺少輸入驗證

### A05: Security Misconfiguration
- Debug 模式未關閉
- 預設密碼
- 錯誤訊息洩露資訊

### A06: Vulnerable Components
- 過期/有漏洞的依賴
- 未更新的套件

### A07: Authentication Failures
- 弱密碼策略
- Session 固定攻擊
- 暴力破解未防護

### A08: Data Integrity Failures
- 不安全的反序列化
- 缺少完整性驗證

### A09: Logging Failures
- 記錄敏感資料（密碼、私鑰）
- 缺少審計日誌

### A10: SSRF
- 未驗證的外部 URL
- 可訪問內網資源

## 輸出格式

### [P0/P1/P2] <問題標題>
- **位置**: file:line
- **類型**: <OWASP 類別>
- **影響**: 潛在危害描述
- **修復**: 具體修復建議
- **測試**: 驗證修復的測試方式

### Gate
- ✅ 可合併：無 P0
- ⛔ 必須修復：有 P0`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

**記住返回的 `threadId`，用於後續循環審核。**

**情況 B：循環審核（有 `--continue`）**

使用 `mcp__codex__codex-reply` 繼續之前的會話：

```typescript
mcp__codex__codex -
  reply({
    threadId: '<從 --continue 參數獲取>',
    prompt: `我已修復之前指出的安全問題。請重新審查：

## 新的代碼變更
\`\`\`diff
${CODE_CHANGES}
\`\`\`

請驗證：
1. 之前的 P0/P1 安全問題是否已正確修復？
2. 修復是否引入了新的安全問題？
3. 修復方式是否符合安全最佳實踐？
4. 更新 Gate 狀態`,
  });
```

### Step 4: 整合輸出

將 Codex 的審核結果整理為標準格式。

## Review Loop 自動化

**⚠️ 遵循 @CLAUDE.md 審核循環規則 ⚠️**

當審核結果為 ⛔ 必須修復 時：

1. 記住 `threadId`
2. 修復 P0/P1 安全問題
3. 使用 `--continue <threadId>` 重新審核
4. 重複直到 ✅ 可合併

## Output

```markdown
## 安全審查報告

### 審查範圍

- Scope: <dir>
- 檔案數：<count>
- 變更行數：<lines>

### 發現摘要

| 等級 | 數量 | 類型 |
| :--: | :--: | :--- |
|  P0  |  N   | ...  |
|  P1  |  N   | ...  |
|  P2  |  N   | ...  |

### 詳細發現

#### [P0] <問題標題>

- **位置**: file:line
- **類型**: OWASP 類別
- **影響**: 潛在危害
- **修復**: 具體建議
- **測試**: 驗證方式

#### [P1] <問題標題>

...

### Gate

✅ 可合併 / ⛔ 必須修復 (N 個 P0)

### 循環審核

如需修復後重新審核，請使用：
`/codex-security --continue <threadId>`
```

## Examples

```bash
# 審查整個 src/
/codex-security

# 審查特定目錄
/codex-security --scope src/controller/

# 修復後繼續審核（保持上下文）
/codex-security --continue abc123
```

## 相關命令

| 命令         | 說明             |
| ------------ | ---------------- |
| `/dep-audit` | npm 依賴漏洞審計 |
| `yarn audit` | npm 原生漏洞掃描 |
