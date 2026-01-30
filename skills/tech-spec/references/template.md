# Tech Spec Template

```markdown
# [功能名稱] 技術方案

## 1. 需求摘要

- 問題：
- 目標：
- 範圍：

## 2. 現有代碼分析

- 相關模組：
- 可複用元件：
- 需要改動的檔案：

## 3. 技術方案

### 3.1 架構設計（Mermaid）

### 3.2 資料模型

### 3.3 API 設計

### 3.4 核心邏輯

## 4. 風險與依賴

## 5. 工作拆分

## 6. 測試策略

## 7. 開放問題
```

## Review Report Template

```markdown
# 技術方案審核報告

## 審核摘要

| 維度 | 評分 | 說明 |
| ---- | ---- | ---- |

## 總體評價

✅ 通過 / ⚠️ 需修改後通過 / ❌ 需重新設計

## 問題與建議

### 🔴 必須修改（Blocker）

### 🟡 建議修改（Improvement）

### 🟢 可選優化（Nice to have）
```

## Architecture Layers

| Layer      | Responsibility   | Pattern            |
| ---------- | ---------------- | ------------------ |
| Controller | API 端點（薄層） | `*.controller.ts`  |
| Service    | 業務邏輯（核心） | `*.service.ts`     |
| Provider   | 外部服務封裝     | `provider/**/*.ts` |
| Entity     | MongoDB 模型     | `entity/*.ts`      |

## Design Checklist

- [ ] 是否複用現有 Service/Provider？
- [ ] 是否遵循 DI 模式？
- [ ] 錯誤處理是否統一？
- [ ] 是否考慮效能（快取、批次）？
- [ ] 測試策略是否完整？

## Review Dimensions

| 維度       | 檢查項                       | Weight |
| ---------- | ---------------------------- | ------ |
| 完整性     | 需求覆蓋、邊界情況、錯誤處理 | High   |
| 可行性     | 技術可行、時程合理、依賴明確 | High   |
| 風險評估   | 風險識別、緩解策略           | Medium |
| 代碼一致性 | 與現有架構一致               | Medium |
| 測試策略   | 測試計畫完整                 | Medium |
