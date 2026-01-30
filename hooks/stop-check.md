# Stop Hook - 智能任務完成檢查

使用 **command 類型** hook，透過 exit code 阻止 Claude 停止。

## 運作方式

腳本 `stop-guard.sh` 會：

1. 讀取對話記錄（transcript）
2. 檢查是否有代碼/文檔變更
3. 檢查是否已執行必要命令
4. **檢查審核是否通過**（✅ Pass / ⛔ Blocked）
5. **Exit 0** = 允許停止，**Exit 2** = 阻止停止

## 檢查規則

| 變更類型       | 需執行                              | 額外檢查  |
| -------------- | ----------------------------------- | --------- |
| `.ts/.js` 代碼 | `/codex-review-fast` + `/precommit` | 審核需 ✅ |
| `.md` 文檔     | `/codex-review-doc`                 | 審核需 ✅ |
| 純註解/無變更  | -                                   | -         |

## 阻止條件

| 條件            | 說明                                                     |
| --------------- | -------------------------------------------------------- |
| 遺漏必要步驟    | 未執行 /codex-review-fast、/precommit、/codex-review-doc |
| ⛔ Blocked      | 審核結果為 Blocked 且無後續 Pass                         |
| 🔴 P0/P1 未修復 | 有 P0/P1 問題且無後續 Pass                               |

## 通過標誌

腳本會檢測以下通過標誌：

- `✅ Pass` / `✅ Ready` / `✅ All pass`
- `Merge Gate.*✅`

## 參考

遵循 @CLAUDE.md 審核循環規則：修復後必須重審，直到 ✅ PASS
