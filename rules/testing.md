# Testing Rules

| 類型        | 目錄                | 環境變數               | Mock      |
| ----------- | ------------------- | ---------------------- | --------- |
| Unit        | `test/unit/`        | `TEST_ENV=unit`        | ✅ 任意   |
| Integration | `test/integration/` | `TEST_ENV=integration` | ⚠️ 僅外部 |
| E2E         | `test/e2e/`         | `TEST_ENV=e2e`         | ❌ 禁止   |

執行: Integration/E2E 預設只跑單一檔案，用 `/verify` 執行
PR 前必跑: `{LINT_FIX_COMMAND} && {TYPECHECK_COMMAND} && {TEST_COMMAND}`

失敗回報: `命令: <cmd> | 錯誤: <cause> | 修復: <fix>`
