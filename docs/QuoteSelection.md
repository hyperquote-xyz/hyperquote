# Quote Selection — Best Execution (V1)

When a user (seller/taker) receives multiple quotes for their RFQ, they need a strategy to select the best one.

## V1 Selection Rules

### Primary: Highest Premium

The seller wants to maximize the premium received. Selection is straightforward:

```
bestQuote = quotes
  .filter(q => q.deadline > now)          // not expired
  .filter(q => q.isMakerSeller === false) // V1 invariant
  .sort((a, b) => b.premium - a.premium)  // highest premium first
  [0]
```

### Filters Applied

1. **Deadline check**: Quote must not be expired (`deadline > block.timestamp`)
2. **V1 invariant**: `isMakerSeller` must be `false`
3. **Premium floor**: If the RFQ specified a `minPremium`, reject quotes below it

### Tiebreakers (not implemented in V1)

When two quotes have the same premium:
1. Prefer quotes with a longer deadline (more time to execute)
2. Prefer lower nonce (less likely to be cancelled)
3. Prefer makers with higher historical fill rate (reputation)

## Quote Validation Before Execution

Before calling `OptionsEngine.execute()`, the taker should verify:

| Check | Why |
|-------|-----|
| `quote.maker != address(0)` | Valid maker address |
| `quote.taker == address(0) OR quote.taker == msg.sender` | Quote is open or targeted to this taker |
| `quote.deadline > block.timestamp` | Quote hasn't expired |
| `quote.isMakerSeller == false` | V1 constraint |
| `quote.underlying` matches RFQ | Correct asset |
| `quote.collateral` matches RFQ | Correct collateral token |
| `quote.isCall` matches RFQ | Correct strategy |
| `quote.strike` matches RFQ | Strike matches |
| `quote.quantity` matches RFQ | Quantity matches |
| `quote.expiry` matches RFQ | Expiry matches |
| Signature is valid | Recovers to `quote.maker` |

The `OptionsEngine` performs all these checks on-chain, but checking off-chain first avoids wasted gas.

## Execution Flow

```
1. User submits RFQ via relay
2. Makers receive RFQ_BROADCAST
3. Makers price and sign quotes
4. User receives QUOTE_BROADCAST(s)
5. User selects best quote (highest premium)
6. User calls: OptionsEngine.execute(quote, signature)
   - This makes the user the taker/seller
   - The user locks collateral (CSP: stablecoins, CC: underlying)
   - The maker's signed quote makes them the buyer
   - Premium is transferred: maker (buyer) -> taker (seller)
   - NFT is minted to maker (buyer)
```

## Future Improvements (V2+)

- **Maker reputation score**: Track fill rate, cancellation rate, time-to-quote
- **Gas optimization**: Batch multiple positions in one transaction
- **Price improvement**: Allow makers to submit updated quotes within a time window
- **Dutch auction**: Premium starts high and decreases over time until a maker accepts
- **Request-for-stream (RFS)**: Persistent two-way price streams instead of one-shot RFQs
