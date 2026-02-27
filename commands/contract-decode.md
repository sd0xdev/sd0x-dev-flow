---
description: EVM contract error and calldata decoder — decode selectors, revert data, calldata via Sourcify/Etherscan/4byte
argument-hint: <hex-data> [--contract <address>] [--chain <chainId>]
allowed-tools: Read, Grep, Glob, Bash, WebFetch
---

## Task

Follow the `contract-decode` skill workflow:

1. **Parse input**: Extract hex data, contract address, chainId from user message or arguments
2. **Classify**: Pure selector (4 bytes) vs calldata/revert (>4 bytes) vs contract address
3. **Local decode**: Try standard Error/Panic decode, then `cast` (if available)
4. **API query**: Sourcify → Etherscan v2 → 4byte.directory (read `references/apis.md` first)
5. **Precise decode**: With ABI, use `cast decode-error` or `cast calldata-decode`
6. **Report**: Output decode report with confidence level

Arguments:
- `<hex-data>`: The hex data to decode (selector, calldata, or revert data)
- `--contract <address>`: Contract address for ABI lookup
- `--chain <chainId>`: Chain ID (default: 1 for Ethereum mainnet)

## Output

Contract Decode Report table with: Type, Selector, Signature, Decoded Args, Confidence, Source, Contract, Chain.
