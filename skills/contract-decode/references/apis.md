# Contract Decode API Reference

## API Priority and Selection

```
Has contract address + chainId?
  → Sourcify (free) → Etherscan v2 (needs key) → 4byte (fallback)
Only have selector?
  → cast 4byte (local) → 4byte.directory API → Etherscan signature DB
```

---

## 1. Sourcify (First Priority)

Full ABI, free, no key required.

### Endpoints

```bash
# Check if contract is verified + metadata
GET https://sourcify.dev/server/v2/contract/{chainId}/{address}

# Get ABI directly
GET https://sourcify.dev/server/v2/contract/{chainId}/{address}/abi
```

### Example

```bash
# Get ABI (Ethereum mainnet, chainId=1)
curl -s "https://sourcify.dev/server/v2/contract/1/0x58749c46ffe97e4d79508a2c781c440f4756f064/abi" \
  | python3 -m json.tool > /tmp/contract_abi.json

# Check if proxy (response contains implementation info)
curl -s "https://sourcify.dev/server/v2/contract/1/0x58749c46ffe97e4d79508a2c781c440f4756f064"
```

### Limits

| Property | Value |
|----------|-------|
| Rate limit | Not publicly stated, returns 429 |
| Recommended self-limit | 3-5 req/s |
| Needs key | No |
| Proxy resolution | Returns implementation info |
| Coverage | Lower than Etherscan (only Sourcify-submitted contracts) |

---

## 2. Etherscan v2 (Second Priority)

Full ABI, highest coverage, requires API key.

### Endpoints

```bash
# v2 format (single key, multi-chain via chainid routing)
GET https://api.etherscan.io/v2/api?chainid={chainId}&module=contract&action=getabi&address={address}&apikey={key}

# Get source code + contract name
GET https://api.etherscan.io/v2/api?chainid={chainId}&module=contract&action=getsourcecode&address={address}&apikey={key}
```

### Chain ID Reference

| Chain | chainId | Note |
|-------|---------|------|
| Ethereum | 1 | mainnet |
| BSC | 56 | BNB Chain |
| Polygon | 137 | Polygon PoS |
| Arbitrum | 42161 | Arbitrum One |
| Optimism | 10 | OP Mainnet |
| Base | 8453 | Base |
| Avalanche | 43114 | C-Chain |

### Example

```bash
# Get ABI
curl -s "https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getabi&address=0x58749c46ffe97e4d79508a2c781c440f4756f064&apikey=YOUR_KEY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])" > /tmp/contract_abi.json

# Get contract name (check if proxy)
curl -s "https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=0x58749c46ffe97e4d79508a2c781c440f4756f064&apikey=YOUR_KEY" \
  | python3 -c "
import sys,json
r=json.load(sys.stdin)['result'][0]
print(f'Name: {r[\"ContractName\"]}')
print(f'Proxy: {r[\"Proxy\"]}')
print(f'Implementation: {r[\"Implementation\"]}')
"
```

### Limits

| Property | Value |
|----------|-------|
| Rate limit (Free) | 5 req/s, 100,000/day |
| Recommended self-limit | 2 req/s |
| Needs key | Yes (free to register) |
| Proxy resolution | `getsourcecode` returns `Proxy` + `Implementation` |
| Coverage | Highest (most verified contracts) |

### API Key

If no key available, remind user to register at https://etherscan.io/myapikey.
For diagnostic scenarios, `YourApiKeyToken` may work for low-frequency queries.

---

## 3. 4byte.directory (Selector Lookup)

selector → function/error signature, free, no key.

### Endpoints

```bash
# Function signatures
GET https://www.4byte.directory/api/v1/signatures/?hex_signature={selector}

# Event signatures
GET https://www.4byte.directory/api/v1/event-signatures/?hex_signature={selector}
```

### Example

```bash
# Lookup function selector
curl -s "https://www.4byte.directory/api/v1/signatures/?hex_signature=0x5e15c749" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for r in d['results']:
    print(r['text_signature'])
"
```

### Limits

| Property | Value |
|----------|-------|
| Rate limit | No hard limit, maintainers request fair use |
| Recommended self-limit | 1 req/s |
| Needs key | No |
| Note | May return multiple candidates (selector collision) |
| Error coverage | Does not support custom error signatures (function + event only) |

---

## 4. cast (Local Tool)

Foundry cast, runs locally, no rate limit.

### Common Commands

```bash
# selector → function name (queries 4byte directory)
cast 4byte 0x5e15c749
# May crash, protect with timeout:
timeout 5 cast 4byte 0x5e15c749

# Calculate selector
cast sig "finalizeWithdrawal(uint256)"
# → 0x5e15c749

# Calculate error selector
cast sig "WithdrawalRequestDoesNotExist()"
# → 0xaca553e4

# Decode calldata (needs signature)
cast calldata-decode "finalizeWithdrawal(uint256)" 0x5e15c7490000000000000000000000000000000000000000000000000000000000001c05

# Decode error data (needs ABI file)
cast decode-error 0xaca553e4 --abi /tmp/contract_abi.json

# ABI decode (needs type signature)
cast abi-decode "Error(string)" 0x00000000...

# Verify selector match
cast sig "WithdrawalRequestDoesNotExist()"
# If output is 0xaca553e4 → confirmed match
```

### Brute-force Matching

When you have a contract ABI but aren't sure which error matches a selector:

```bash
# Extract all custom errors from ABI, compute each selector
cat /tmp/contract_abi.json | python3 -c "
import sys,json
abi = json.load(sys.stdin)
for item in abi:
    if item.get('type') == 'error':
        name = item['name']
        inputs = ','.join(i['type'] for i in item.get('inputs', []))
        sig = f'{name}({inputs})'
        print(sig)
" | while read sig; do
    sel=$(cast sig "$sig" 2>/dev/null)
    echo "$sel → $sig"
done | grep "0xaca553e4"
```

### Limits

| Property | Value |
|----------|-------|
| Version requirement | cast 1.x+ |
| `cast 4byte` stability | Occasional crashes (use `timeout`) |
| `cast decode-error` | Requires ABI file |
| Offline capability | `cast sig` works offline, `cast 4byte` needs network |

---

## Proxy Contract Handling

EVM proxy contracts' ABIs typically contain only admin/upgrade functions. You need the implementation's ABI.

### Flow

```
1. Query contract ABI (Sourcify/Etherscan)
2. Check if proxy (ContractName contains "Proxy" or ABI only has admin functions)
3. If proxy → get implementation address
4. Re-query ABI with implementation address
5. Decode using implementation ABI
```

### Get Implementation Address

```bash
# Method 1: Etherscan getsourcecode returns it directly
# result[0].Implementation = "0xBD6A5eC8..."

# Method 2: Read EIP-1967 storage slot
cast storage <proxy_addr> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url https://eth.llamarpc.com
# Returns implementation address (strip leading zeros)
```
