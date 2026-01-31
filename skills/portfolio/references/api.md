# Portfolio API Reference

## Base Path

`/onchain/v1/portfolio`

## Endpoints

| Endpoint     | Method | Description             |
| ------------ | ------ | ----------------------- |
| `/positions` | POST   | Get portfolio positions |
| `/chains`    | GET    | Supported chains list   |
| `/protocols` | GET    | Supported protocols list |

## POST /positions

### Request

```typescript
{
  accountAddress: string;      // Required, wallet address
  networkId: string;           // Required, e.g. '<impl>--<chainId>'
  protocolIds?: string;        // Optional, comma-separated
  isForceRefresh?: boolean;    // Bypass cache
  summaryOnly?: boolean;       // Return totals only
  sortBy?: 'value_desc' | 'value_asc' | 'none';
  groupMerge?: boolean;        // Merge LP positions (default true)
  currency?: string;           // Default 'usd'
}
```

## Position Model

```typescript
interface Position {
  networkId: string; // '<impl>--<chainId>', '<impl>--<chainId>'
  owner: string; // Wallet address
  protocol: string; // 'aave-v3', 'uniswap-v3'
  protocolName?: string;
  category: PositionCategory; // lending, staking, liquidity, etc.

  assets: PositionAsset[]; // Deposits, LP tokens
  debts: PositionDebt[]; // Borrowed amounts
  rewards: PositionReward[]; // Claimable rewards
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
  totalValue: number;      // Total asset value
  totalReward: number;     // Total reward value
  totalDebt: number;       // Total debt value
  netWorth: number;        // Net worth = value + reward - debt
  chains: string[];
  protocolCount: number;
  positionCount: number;
}
```

### ProtocolSummary

Aggregated by protocol: protocol info + aggregated metrics + position references

## Currency Conversion (3-Tier)

| Tier | Condition                   | Handling         |
| ---- | --------------------------- | ---------------- |
| 1    | {PRIMARY_PROVIDER} natively supported | Pass directly to API |
| 2    | CoinGecko has exchange rate | USD x rate       |
| 3    | No exchange rate            | Fallback to USD  |

**Native currencies**: usd, eur, gbp, jpy, cny, krw, aud, cad, chf, nzd, inr, btc, eth

## Feature Toggles

| Config                                | Description        |
| ------------------------------------- | ------------------ |
| `features.portfolio.enabled`          | Global toggle      |
| `features.portfolio.positionsTtl`     | Positions TTL      |
| `features.portfolio.maxStale`         | Max stale duration |
| `features.portfolio.providerGroupMerge` | Merge LP         |
