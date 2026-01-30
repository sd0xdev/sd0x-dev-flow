# 問題分類詳細指引

## 分類維度

| 維度       | 判斷依據               | 範例                           |
| ---------- | ---------------------- | ------------------------------ |
| 時間性     | 以前正常 vs 一直如此   | 「更新後壞了」vs「一直這樣」   |
| 確定性     | 必現 vs 間歇性         | 「每次都會」vs「有時候」       |
| 錯誤類型   | 有 stack trace vs 邏輯 | TypeError vs 回傳值不對        |
| 複雜度     | 單一模組 vs 跨模組     | Service 內部 vs Service 間互動 |
| 可能原因數 | 明確 vs 多種可能       | 「null pointer」vs「效能問題」 |

## 分類矩陣

| 時間性   | 確定性 | 複雜度 | 策略                                     |
| -------- | ------ | ------ | ---------------------------------------- |
| 回歸     | 必現   | 低     | `/git-investigate`                       |
| 回歸     | 必現   | 高     | `/git-investigate` + `/code-investigate` |
| 回歸     | 間歇   | -      | `/code-investigate`                      |
| 一直如此 | 必現   | 低     | `/code-explore`                          |
| 一直如此 | 必現   | 高     | `/code-investigate`                      |
| 一直如此 | 間歇   | -      | `/codex-brainstorm`                      |
| 不確定   | -      | -      | `/code-explore` 先探索                   |

## 關鍵詞觸發

### → `/git-investigate`

- 「以前可以」「更新後」「上次還好好的」「回歸」
- 「什麼時候壞的」「誰改的」「哪個 commit」

### → `/code-explore`

- 「這功能怎麼運作」「這段代碼做什麼」「流程是什麼」
- 「不知道在哪裡」「怎麼追蹤」

### → `/code-investigate`

- 「需要確認」「有點複雜」「不確定原因」
- 「間歇性」「有時候會」「隨機」

### → `/codex-brainstorm`

- 「可能原因很多」「怎麼判斷」「窮舉一下」
- 「有哪些可能」「不確定是什麼問題」

## 複合策略

當問題複雜時，可組合使用：

```
1. /code-explore → 先建立基礎理解
2. /git-investigate → 如果發現可能是回歸
3. /code-investigate → 需要雙重確認時
4. /codex-brainstorm → 窮舉所有可能原因
```

## 升級路徑

```
初步調查不足 → 升級策略

/code-explore 找不到原因
    → 升級到 /code-investigate（加入 Codex 視角）

/git-investigate 找到 commit 但不理解原因
    → 配合 /code-explore（理解變更邏輯）

/code-investigate 雙視角有分歧
    → 升級到 /codex-brainstorm（對抗辯論）
```
