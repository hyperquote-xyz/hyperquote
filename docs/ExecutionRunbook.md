# Execution Runbook

Step-by-step guide to executing a full HyperQuote RFQ cycle from relay to on-chain settlement.

## Prerequisites

- **Anvil** (Foundry) running on `localhost:8545`
- **Contracts deployed** via `forge script` or test deployment
- **Node.js 20+** with `tsx` available
- All packages installed: `npm install` in `services/relay/`, `packages/sdk-maker/`, `scripts/execute/`, `scripts/relay-demo/`

## Accounts (Anvil Defaults)

| Role    | Account | Address                                    |
|---------|---------|-------------------------------------------|
| Owner   | #0      | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 |
| Maker   | #1      | 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 |
| Seller  | #2      | 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC |

## Step-by-Step

### 1. Start Anvil

```bash
anvil
```

### 2. Deploy Contracts

```bash
# From project root
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

Or use the Foundry test deployment (contracts auto-deployed at deterministic addresses).

### 3. Start Relay

```bash
cd services/relay
npx tsx src/server.ts
```

Verify:
```bash
curl http://127.0.0.1:8080/health
```

### 4. Start Maker Bot

In a new terminal:
```bash
cd packages/sdk-maker
npx tsx src/makerRelay.ts
```

The bot connects to the relay and waits for RFQ broadcasts.

### 5. Submit RFQ

In a new terminal:
```bash
cd scripts/relay-demo
npx tsx submitRfq.ts
```

This:
- Creates a CSP RFQ (WHYPE/USDC, K=$25, Q=1, 7-day expiry)
- Signs it with EIP-191 (anvil account 2)
- Submits to relay
- Listens for maker quotes (30s timeout)

Expected output:
```
[RFQ_BROADCAST] rfqId=0x...
[QUOTE #1] from 0x7099... premium=2034292 (2.034292 USDC)
```

### 6. Execute Quote

```bash
cd scripts/execute
npx tsx executeQuote.ts --rfqId <PASTE_RFQ_ID_HERE>
```

Or simulate first:
```bash
npx tsx executeQuote.ts --rfqId <RFQ_ID> --simulate
```

The execution client:
1. Fetches quotes from relay REST API
2. Selects highest-premium quote
3. Validates locally (deadline, signature, parameters)
4. Checks on-chain nonce + quote-not-used
5. Approves collateral (CSP: stablecoin, CC: underlying)
6. Calls `OptionsEngine.execute(quote, makerSig)`
7. Parses `QuoteExecuted` event for positionId

### 7. Verify Position

After execution:
```bash
# Check position via cast
cast call $ENGINE "getPosition(uint256)" 1 --rpc-url http://127.0.0.1:8545
```

Or verify via logs:
```
Position ID: 1
Buyer:  0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (maker)
Seller: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (taker)
Premium: 2034292 (transferred buyer→seller)
Collateral: 25000000 (locked by seller)
```

## Automated Demo

Run all steps in one command:
```bash
cd scripts/execute
npx tsx demo.ts
```

This orchestrates relay, maker bot, RFQ submission, and execution automatically.

## Quote Selection Rules

The execution client selects the **best quote for the seller**:

1. **Highest premium** — seller wants maximum income
2. **Tie-break: latest deadline** — more time to execute
3. **Tie-break: maker address** — lexicographic (deterministic)

## Signature Verification Chain

```
User signs RFQ     → EIP-191 personal_sign(rfqId bytes)
  → Relay verifies → keccak256(abi.encode(rfq fields)) == rfqId, recover(sig) == requester
  → Broadcasts RFQ

Maker signs Quote  → EIP-712 signTypedData(domain, Quote, value)
  → Relay verifies → recover(domain, Quote types, value, sig) == maker
  → Broadcasts Quote

Seller executes    → OptionsEngine.execute(quote, makerSig)
  → Contract verifies → ECDSA.recover(EIP-712 digest, sig) == quote.maker
  → Position minted, collateral locked, premium transferred
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `QuoteExpired` | Quote deadline passed | Re-submit RFQ for fresh quotes |
| `NonceTooLow` | Maker incremented nonce | Re-submit RFQ |
| `TakerMismatch` | Targeted quote, wrong sender | Use the correct seller key |
| `CollateralNotAllowed` | Token not whitelisted | Admin must call `setAllowedCollateral` |
| `InvalidSignature` | Sig doesn't match maker | Chain ID or engine address mismatch |
| Insufficient balance | Seller can't lock collateral | Fund the seller account |
| Buyer allowance low | Maker hasn't approved premium | Maker must approve before quote |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `RELAY_URL` | `http://127.0.0.1:8080` | Relay REST base URL |
| `RELAY_WS_URL` | `ws://127.0.0.1:8080` | Relay WebSocket URL |
| `ENGINE_ADDRESS` | Foundry deterministic | OptionsEngine contract |
| `CHAIN_ID` | `31337` | Chain ID for EIP-712 |
| `SELLER_PRIVATE_KEY` | Anvil #2 | Seller (taker) private key |
| `MAKER_PRIVATE_KEY` | Anvil #1 | Maker (buyer) private key |
