# HyperQuote SpotRFQ — Deployments

## HyperEVM Mainnet (Chain ID: 999)

| Property | Value |
|----------|-------|
| **Contract** | `HyperEvmRfq` |
| **Address** | [`0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017`](https://hyperscan.xyz/address/0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017) |
| **Deployer** | See deploy tx |
| **Owner** | `0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1` |
| **Fee Recipient** | `0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1` |
| **Fee Pips** | `250` (2.5 bps / 0.025%) |
| **Solidity** | 0.8.20 |
| **Optimizer** | Enabled, 200 runs |
| **EVM Target** | Paris |
| **Deploy Tx** | [`0xae991aa21b6e38d944e6b381b374c161bd3c8ddbb90c0ff88b3b5ced0ab561dd`](https://hyperscan.xyz/tx/0xae991aa21b6e38d944e6b381b374c161bd3c8ddbb90c0ff88b3b5ced0ab561dd) |
| **Block** | `30220144` |
| **Verified** | Pending |

### EIP-712 Domain

```json
{
  "name": "HyperQuote",
  "version": "1",
  "chainId": 999,
  "verifyingContract": "0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017"
}
```

### Domain Separator

```
0xd725f898dc80270b9e3ec3c9f91c0a842b94a1f5dc89f9d96630d2f093769450
```

### Constructor Arguments

```
_owner:        0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1
_feeRecipient: 0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1
_feePips:      250
```

### Verification

**Automated (try first):**

```bash
forge verify-contract 0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017 \
  src/HyperEvmRfq.sol:HyperEvmRfq \
  --chain-id 999 \
  --constructor-args $(cast abi-encode "constructor(address,address,uint32)" \
    0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1 \
    0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1 \
    250) \
  --verifier-url https://api.hyperscan.xyz/api \
  --etherscan-api-key <API_KEY>
```

**Manual fallback (if automated fails):**

1. Open https://hyperscan.xyz/address/0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017#code
2. Click "Verify & Publish"
3. Select: Solidity, Single file (flattened) or Standard JSON
4. Compiler: 0.8.20, Optimizer: Yes (200 runs), EVM: Paris
5. Paste source or upload Standard JSON from `out/HyperEvmRfq.sol/HyperEvmRfq.json`
6. Constructor args (ABI-encoded): use output of
   `cast abi-encode "constructor(address,address,uint32)" 0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1 0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1 250`
7. Confirm green checkmark appears on the Contract tab

### Post-Deploy Checks

```bash
cast call 0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017 "owner()(address)" --rpc-url https://rpc.hyperliquid.xyz/evm
# → 0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1

cast call 0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017 "feePips()(uint32)" --rpc-url https://rpc.hyperliquid.xyz/evm
# → 250

cast call 0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017 "feeRecipient()(address)" --rpc-url https://rpc.hyperliquid.xyz/evm
# → 0xC34B84902Be7aC05a4E78d02b4e25A85E2F3d5A1

cast call 0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017 "DOMAIN_SEPARATOR()(bytes32)" --rpc-url https://rpc.hyperliquid.xyz/evm
# → 0xd725f898dc80270b9e3ec3c9f91c0a842b94a1f5dc89f9d96630d2f093769450
```

### Production App

https://hyperquote.xyz

---

## Local Development (Anvil)

| Property | Value |
|----------|-------|
| **Address** | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| **Owner** | Anvil account #0 |
| **Fee Recipient** | Anvil account #0 |
| **Fee Pips** | `250` |

```bash
# Deploy to local Anvil
anvil &
cd contracts/spot-rfq
forge script script/Deploy.s.sol:DeployTestnet \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
