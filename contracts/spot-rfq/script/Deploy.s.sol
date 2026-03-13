// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {HyperEvmRfq} from "../src/HyperEvmRfq.sol";

/**
 * @title Deploy
 * @notice Deployment script for HyperEvmRfq contract
 * 
 * Usage:
 *   # Dry run (simulation)
 *   forge script script/Deploy.s.sol --rpc-url <RPC_URL>
 * 
 *   # Broadcast (actual deployment)
 *   forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast --private-key <PRIVATE_KEY>
 * 
 * Environment variables:
 *   OWNER_ADDRESS     - Contract owner (defaults to deployer)
 *   FEE_RECIPIENT     - Address to receive protocol fees
 *   FEE_PIPS          - Fee in pips (default: 250 = 2.5 bps)
 */
contract Deploy is Script {
    function run() external {
        // Load configuration from environment or use defaults
        address owner = vm.envOr("OWNER_ADDRESS", msg.sender);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint32 feePips = uint32(vm.envOr("FEE_PIPS", uint256(250)));

        console2.log("Deploying HyperEvmRfq with:");
        console2.log("  Owner:", owner);
        console2.log("  Fee Recipient:", feeRecipient);
        console2.log("  Fee Pips:", feePips);

        vm.startBroadcast();

        HyperEvmRfq rfq = new HyperEvmRfq(owner, feeRecipient, feePips);

        vm.stopBroadcast();

        console2.log("");
        console2.log("HyperEvmRfq deployed at:", address(rfq));
        console2.log("Domain Separator:", vm.toString(rfq.DOMAIN_SEPARATOR()));
    }
}

/**
 * @title DeployTestnet
 * @notice Convenience script for testnet deployment with hardcoded test values
 */
contract DeployTestnet is Script {
    function run() external {
        // For testnet, use deployer as both owner and fee recipient
        address deployer = msg.sender;
        uint32 feePips = 250; // 2.5 bps

        console2.log("Deploying HyperEvmRfq to testnet:");
        console2.log("  Owner/FeeRecipient:", deployer);
        console2.log("  Fee Pips:", feePips);

        vm.startBroadcast();

        HyperEvmRfq rfq = new HyperEvmRfq(deployer, deployer, feePips);

        vm.stopBroadcast();

        console2.log("");
        console2.log("HyperEvmRfq deployed at:", address(rfq));
    }
}
