import { AbiCoder, keccak256 } from "ethers";
import { RFQ, RFQJson, rfqFromJson } from "./types.js";

/**
 * Compute the deterministic rfqId from an RFQ.
 * rfqId = keccak256(abi.encode(requester, underlying, collateral, isCall,
 *                               strike, quantity, expiry, minPremium, timestamp))
 *
 * This is used by both the relay and SDK to identify RFQs.
 */
export function computeRfqId(rfq: RFQ): string {
  const coder = AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(
    [
      "address",
      "address",
      "address",
      "bool",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
    ],
    [
      rfq.requester,
      rfq.underlying,
      rfq.collateral,
      rfq.isCall,
      rfq.strike,
      rfq.quantity,
      rfq.expiry,
      rfq.minPremium,
      rfq.timestamp,
    ],
  );
  return keccak256(encoded);
}

/**
 * Compute rfqId from a JSON-serialized RFQ.
 */
export function computeRfqIdFromJson(rfqJson: RFQJson): string {
  return computeRfqId(rfqFromJson(rfqJson));
}
