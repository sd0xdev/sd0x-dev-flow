---
name: contract-decode
description: "EVM contract error and calldata decoder. Use when: user pastes hex revert data, calldata, function selector, or mentions custom error, execution reverted, 4byte, decode. Input contains 0x + 8+ hex chars."
allowed-tools: Read, Grep, Glob, Bash, WebFetch
context: fork
---

# Contract Decode — EVM Error & Calldata Decoder

Decode EVM contract function selectors, custom errors, calldata, and revert data.

## Trigger

- Keywords: revert, selector, 4byte, calldata, decode, custom error, execution reverted, abi decode
- Message contains `0x` + 8+ hex chars (selector or revert data)

## When NOT to Use

- Standard `Error(string)` revert already handled by your codebase
- Non-EVM chain errors
- Only need error code definitions (not hex decoding)

## Input Parsing

Extract from user input:

| Field | Source | Example |
|-------|--------|---------|
| `revertData` | Error data or user-pasted hex | `0xaca553e4` |
| `calldata` | Transaction data | `0x5e15c749000...1c05` |
| `contractAddr` | Contract address | `0x5874...f064` |
| `chainId` | Chain identifier | `1` (Ethereum mainnet) |

## Workflow

```
Step 1: Classify input → Step 2: Local fast decode → Step 3: ABI query → Step 4: Precise decode → Report
```

### Step 1: Classify Input

| Length | Classification | Next Step |
|--------|---------------|-----------|
| 4 bytes (`0x` + 8 hex) | Pure selector | Step 2 |
| > 4 bytes, with selector prefix | Calldata or revert data | Step 2 + Step 3 |
| Contract address | Need ABI first | Step 3 |

### Step 2: Local Fast Decode (no external dependencies)

Try in order:

**2a. Standard error decode**

| Selector | Type | Decode Method |
|----------|------|---------------|
| `0x08c379a0` | `Error(string)` | `cast abi-decode "Error(string)" <data>` |
| `0x4e487b71` | `Panic(uint256)` | `cast abi-decode "Panic(uint256)" <data>` → lookup panic code |

Panic code reference:

| Code | Meaning |
|------|---------|
| 0x00 | generic compiler panic |
| 0x01 | assert failure |
| 0x11 | arithmetic overflow |
| 0x12 | division by zero |
| 0x21 | enum conversion |
| 0x22 | storage encoding |
| 0x31 | pop empty array |
| 0x32 | array out of bounds |
| 0x41 | too much memory |
| 0x51 | zero function pointer |

**2b. Selector lookup (`cast`)** — optional, skip if `cast` not installed

```bash
timeout 5 cast 4byte <selector>
```

If `cast` is unavailable or crashes, fall back to Step 3 API query.

### Step 3: External API Query

See @references/apis.md for full endpoints and parameters.

**Query strategy**:

```
Has contract address? → 3a. ABI path (precise) → get ABI → Step 4
No contract address?  → 3b. Selector DB path (candidates) → get signature candidates
```

**3a. ABI path** (has contract address + chainId)

1. **Sourcify** (free, no key) → get full ABI JSON
2. **Etherscan v2** (needs key, free tier 3 req/s) → get ABI JSON
3. If proxy → get implementation address → re-query ABI

**3b. Selector DB path** (no contract address or ABI query failed)

1. **4byte.directory** API → may return multiple candidates
2. Multiple candidates → mark `confidence: low`, list all possibilities

### Step 4: Precise Decode

With ABI, use `cast` (if available):

```bash
# Decode revert data (needs ABI file)
cast decode-error <revert_data> --abi <abi_file>

# Decode calldata
cast decode-calldata <calldata> --abi <abi_file>

# Or decode with signature directly
cast calldata-decode "functionName(type1,type2)" <calldata>
```

Without ABI but with signature candidates:

```bash
cast abi-decode "functionName(type1,type2)" <data_without_selector>
```

## Output Format

```markdown
## Contract Decode Report

| Field | Value |
|-------|-------|
| Type | function call / revert error / event |
| Selector | `0x5e15c749` |
| Signature | `finalizeWithdrawal(uint256)` |
| Decoded Args | `tokenId: 7173` |
| Confidence | High (verified ABI) / Medium (selector DB) / Low (multiple candidates) |
| Source | Sourcify / Etherscan / 4byte.directory / cast |
| Contract | `0x5874...f064` |
| Chain | Ethereum Mainnet (chainId: 1) |

### Raw Data

- Revert: `0xaca553e4`
- Calldata: `0x5e15c749000...1c05`
```

Multiple candidates:

```markdown
### Ambiguous Candidates

| # | Signature | Confidence |
|---|-----------|------------|
| 1 | `WithdrawalRequestDoesNotExist()` | Likely (context match) |
| 2 | `SomeOtherError()` | Unlikely |
```

## References

| File | Purpose | When to Read |
|------|---------|-------------|
| `references/apis.md` | API endpoints, parameters, rate limits | Before Step 3 |

## Verification

- [ ] Input correctly classified (selector / calldata / revert data)
- [ ] Local fast decode attempted (Error/Panic/cast)
- [ ] External query returned results or marked as failed
- [ ] Confidence level indicated
- [ ] Multiple candidates listed (if any)

## Examples

```
Input: Decode 0xaca553e4
Action: 4 bytes → selector → cast 4byte → 4byte.directory → return candidate signatures
```

```
Input: What is this revert data 0x08c379a0000...
Action: selector = Error(string) → local cast abi-decode → return error message
```

```
Input: Decode this with contract 0x5874..., chainId 1, revert data 0xaca553e4
Action: Has contract + chainId → Sourcify ABI → cast decode-error → precise decode
```
