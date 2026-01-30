---
name: portfolio
description: Portfolio system knowledge base. Covers position queries, routing strategies, {PRIMARY_PROVIDER} integration, cache design.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Portfolio Skill

## Trigger

- Keywords: Portfolio, portfolio, 持倉, position, {PRIMARY_PROVIDER}, 協議, lending, staking, liquidity

## When NOT to Use

- 一般代幣查詢（非 Portfolio 持倉）
- 交易構建（用對應 provider）
- 非 portfolio 相關的 API 問題

## Core Files

| Type       | File                                               | Purpose       |
| ---------- | -------------------------------------------------- | ------------- |
| Controller | `src/entity/portfolio/portfolio.controller.ts`     | REST API      |
| Router     | `src/service/portfolio/source-router/*.service.ts` | 路由編排      |
| Client     | `src/service/portfolio/providers/{provider}/*.ts`      | {PRIMARY_PROVIDER} 整合   |
| Aggregator | `src/service/portfolio/aggregation/*.service.ts`   | 聚合計算      |
| DTO        | `src/dto/portfolio/position.types.ts`              | Position 模型 |

## API Overview

**Base**: `/onchain/v1/portfolio`

| Endpoint     | Method | Purpose        |
| ------------ | ------ | -------------- |
| `/positions` | POST   | 獲取 Portfolio 持倉 |
| `/chains`    | GET    | 支援鏈列表     |
| `/protocols` | GET    | 支援協議列表   |

## Verification

- Position 資料正確標準化
- 緩存命中/失效正常運作
- 聚合計算準確

## Development Guide

### Add Protocol Support

1. 確認 {PRIMARY_PROVIDER} 是否支援
2. 若需自建：實作 `PortfolioPositionExtractor` + 註冊 + 配置路由

### Add Data Source

1. 實作 `ProviderClient` + `Adapter`
2. 註冊到 `SourceRouter`
3. 配置路由策略

### Debug

```bash
redis-cli keys "portfolio:{provider}:*"
redis-cli get "portfolio:{provider}:positions:0x...:v2:..."
curl -X POST /positions -d '{"isForceRefresh": true, ...}'
```

## References

- `references/architecture.md` - 系統架構 + 緩存策略
- `references/api.md` - API 參考 + 資料模型
- @docs/features/portfolio/ - 詳細文檔

## Tests

| Type        | Location                       |
| ----------- | ------------------------------ |
| Unit        | `test/unit/service/portfolio/` |
| Integration | `test/integration/portfolio/`  |

## Examples

```
輸入：Portfolio portfolio 怎麼查詢持倉？
動作：說明 POST /positions API + 路由策略
```

```
輸入：{PRIMARY_PROVIDER} 整合怎麼運作？
動作：說明 {PRIMARY_PROVIDER}Client + {PRIMARY_PROVIDER}Adapter 流程
```
