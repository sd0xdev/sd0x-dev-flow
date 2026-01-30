# Portfolio API Reference

## Base Path

`/onchain/v1/portfolio`

## Endpoints

| Endpoint     | Method | Description    |
| ------------ | ------ | -------------- |
| `/positions` | POST   | 獲取 Portfolio 持倉 |
| `/chains`    | GET    | 支援鏈列表     |
| `/protocols` | GET    | 支援協議列表   |

## POST /positions

### Request

```typescript
{
  accountAddress: string;      // 必填，錢包地址
  networkId: string;           // 必填，如 '<impl>--<chainId>'
  protocolIds?: string;        // 可選，逗號分隔
  isForceRefresh?: boolean;    // 繞過緩存
  summaryOnly?: boolean;       // 僅返回總額
  sortBy?: 'value_desc' | 'value_asc' | 'none';
  groupMerge?: boolean;        // 合併 LP positions（預設 true）
  currency?: string;           // 預設 'usd'
}
```

## Position Model

```typescript
interface Position {
  networkId: string; // '<impl>--<chainId>', '<impl>--<chainId>'
  owner: string; // 錢包地址
  protocol: string; // 'aave-v3', 'uniswap-v3'
  protocolName?: string;
  category: PositionCategory; // lending, staking, liquidity, etc.

  assets: PositionAsset[]; // 存款、LP 代幣
  debts: PositionDebt[]; // 借入金額
  rewards: PositionReward[]; // 可領取獎勵
  metrics: PositionMetrics; // APY, HF, LTV

  source: PositionSource; // provider, fetchedAt, cached
  groupId?: string; // {PRIMARY_PROVIDER} group_id
}

enum PositionCategory {
  LENDING,
  STAKING,
  LIQUIDITY,
  YIELD,
  DEPOSIT,
  LOCKED,
  REWARDS,
  VESTING,
  OTHER,
}
```

## Aggregation Models

### PortfolioTotals

```typescript
{
  totalValue: number;      // 資產總值
  totalReward: number;     // 獎勵總值
  totalDebt: number;       // 債務總值
  netWorth: number;        // 淨資產 = value + reward - debt
  chains: string[];
  protocolCount: number;
  positionCount: number;
}
```

### ProtocolSummary

按協議聚合：協議資訊 + 聚合指標 + 位置引用

## Currency Conversion (3-Tier)

| Tier | Condition        | Handling     |
| ---- | ---------------- | ------------ |
| 1    | {PRIMARY_PROVIDER} 原生支援  | 直接傳給 API |
| 2    | CoinGecko 有匯率 | USD × 匯率   |
| 3    | 無匯率           | 回退 USD     |

**原生貨幣**：usd, eur, gbp, jpy, cny, krw, aud, cad, chf, nzd, inr, btc, eth

## Feature Toggles

| Config                                | Description  |
| ------------------------------------- | ------------ |
| `features.portfolio.enabled`          | 全局開關     |
| `features.portfolio.positionsTtl`     | 位置 TTL     |
| `features.portfolio.maxStale`         | 最大過期時間 |
| `features.portfolio.providerGroupMerge` | 合併 LP      |
