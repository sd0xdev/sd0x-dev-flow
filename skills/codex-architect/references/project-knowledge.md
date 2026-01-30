# Project-Specific Architecture Knowledge

## Project Structure

```
src/
├── controller/     # API 端點（薄層）
├── service/        # 業務邏輯（核心）
├── provider/       # 外部服務封裝
├── entity/         # MongoDB 模型
├── interface/      # TypeScript 介面
└── config/         # 配置
```

## Common Architecture Decisions

| Decision Point | Options                | Project Convention |
| -------------- | ---------------------- | ------------------ |
| Cache Strategy | Redis / Local / Hybrid | Redis 為主         |
| Data Access    | Repository / Direct    | Mongoose 直接查詢  |
| Error Handling | Throw / Result Type    | 統一異常類         |
| DI             | Constructor / Property | @Inject() 屬性注入 |

## Output Report Template

```markdown
# 架構諮詢報告

## 問題

<用戶的問題>

## Codex 建議

<Codex 的完整輸出>

## Claude 觀點

<Claude 的補充或不同意見>

## 綜合建議

### 共識點

- 兩者一致的建議

### 差異點

| 議題 | Codex | Claude | 建議採用 |
| ---- | ----- | ------ | -------- |

### 最終建議

<整合後的方案>
```

## Usage Scenarios

| Scenario     | Description          | Mode    |
| ------------ | -------------------- | ------- |
| 設計新功能   | 從零開始設計架構     | design  |
| 重構現有系統 | 評估重構方案         | review  |
| 技術選型     | 選擇技術棧/框架      | compare |
| 方案驗證     | 驗證已有方案的合理性 | review  |
| 效能優化     | 設計優化策略         | design  |
| API 設計     | 設計 RESTful API     | design  |

## Workflow Integration

```
設計階段 → /codex-architect    獲取雙視角建議
    ↓
規劃階段 → /tech-spec          產出技術方案文件
    ↓
審核階段 → /review-spec        審核技術方案
    ↓
實作階段 → /codex-implement    Codex 寫代碼
    ↓
審查階段 → /codex-review-fast  審查代碼品質
```
