---
name: portfolio
description: Portfolio system knowledge base. Covers position queries, routing strategies, {PRIMARY_PROVIDER} integration, cache design.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Portfolio Skill

## Trigger

- Keywords: Portfolio, portfolio, position, {PRIMARY_PROVIDER}, protocol, lending, staking, liquidity

## When NOT to Use

- General token queries (not Portfolio positions)
- Transaction building (use corresponding provider)
- Non-portfolio related API issues

## Core Files

| Type       | File                                               | Purpose                 |
| ---------- | -------------------------------------------------- | ----------------------- |
| Controller | `src/entity/portfolio/portfolio.controller.ts`     | REST API                |
| Router     | `src/service/portfolio/source-router/*.service.ts` | Routing orchestration   |
| Client     | `src/service/portfolio/providers/{provider}/*.ts`  | {PRIMARY_PROVIDER} integration |
| Aggregator | `src/service/portfolio/aggregation/*.service.ts`   | Aggregation computation |
| DTO        | `src/dto/portfolio/position.types.ts`              | Position model          |

## API Overview

**Base**: `/onchain/v1/portfolio`

| Endpoint     | Method | Purpose               |
| ------------ | ------ | --------------------- |
| `/positions` | POST   | Get portfolio positions |
| `/chains`    | GET    | Supported chains list |
| `/protocols` | GET    | Supported protocols list |

## Verification

- Position data correctly normalized
- Cache hit/miss working properly
- Aggregation calculations accurate

## Development Guide

### Add Protocol Support

1. Check if {PRIMARY_PROVIDER} supports it
2. If custom build needed: implement `PortfolioPositionExtractor` + register + configure routing

### Add Data Source

1. Implement `ProviderClient` + `Adapter`
2. Register with `SourceRouter`
3. Configure routing strategy

### Debug

```bash
redis-cli keys "portfolio:{provider}:*"
redis-cli get "portfolio:{provider}:positions:0x...:v2:..."
curl -X POST /positions -d '{"isForceRefresh": true, ...}'
```

## References

- `references/architecture.md` - System architecture + cache strategy
- `references/api.md` - API reference + data models
- @docs/features/portfolio/ - Detailed documentation

## Tests

| Type        | Location                       |
| ----------- | ------------------------------ |
| Unit        | `test/unit/service/portfolio/` |
| Integration | `test/integration/portfolio/`  |

## Examples

```
Input: How to query portfolio positions?
Action: Explain POST /positions API + routing strategy
```

```
Input: How does {PRIMARY_PROVIDER} integration work?
Action: Explain {PRIMARY_PROVIDER}Client + {PRIMARY_PROVIDER}Adapter flow
```
