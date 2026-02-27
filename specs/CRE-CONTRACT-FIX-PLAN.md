# CRE Contract Fix Plan

## Problem

Current smart contracts (`PriceIntegrity`, `Settlement`, `PoolReserve`, `LPDistributor`, `StrategyManager`) cannot receive reports from CRE workflows because they don't implement the required `IReceiver` interface.

CRE workflows don't call contracts directly. Instead:
1. Workflow produces a signed report
2. EVM capability sends report to Chainlink `KeystoneForwarder`
3. Forwarder validates signatures
4. Forwarder calls `onReport()` on consumer contract

## Solution

All consumer contracts must:
1. Implement `IReceiver` interface
2. Inherit from `ReceiverTemplate` (recommended)
3. Implement `_processReport(bytes calldata report)` for business logic

## Official Documentation

- Guide: https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
- `ReceiverTemplate.sol`: Abstract contract with security features
- `IReceiver.sol`: Interface requiring `onReport()` function

---

## Fix Tasks

### Task 1: Add Required Interface Files

**Files to Create:**
- `contracts/src/interfaces/IReceiver.sol`
- `contracts/src/interfaces/IERC165.sol` (if not already present)
- `contracts/src/abstracts/ReceiverTemplate.sol`

**Source:** Copy from Chainlink CRE documentation

---

### Task 2: Update PriceIntegrity Contract

**File:** `contracts/src/PriceIntegrity.sol`

**Changes:**
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Roles} from "./Roles.sol";
import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
// ... other imports

/// @title PriceIntegrity
/// @notice Receives and stores price integrity reports from CRE workflow
/// @dev Inherits ReceiverTemplate for secure report handling
contract PriceIntegrity is ReceiverTemplate {
    // ... existing code ...

    /// @param _roles Address of the Roles contract
    /// @param _forwarder Address of the Chainlink KeystoneForwarder
    constructor(address _roles, address _forwarder) 
        ReceiverTemplate(_forwarder) 
    {
        // ... existing constructor code ...
    }

    /// @notice Process incoming price integrity reports from CRE workflow
    /// @param report ABI-encoded PriceIntegrityPayload
    function _processReport(bytes calldata report) internal override {
        // Decode report from workflow
        (
            uint256 epochId,
            uint256 windowStart,
            uint256 candleCount,
            bytes32 internalCandlesHash,
            bytes32 chainlinkCandlesHash,
            uint256 ohlcMaeBps,
            uint256 ohlcP95Bps,
            uint256 ohlcMaxBps,
            uint256 directionMatchBps,
            uint256 outlierCount,
            uint256 scoreBps,
            bytes32 diffMerkleRoot
        ) = abi.decode(
            report, 
            (uint256, uint256, uint256, bytes32, bytes32, uint256, uint256, uint256, uint256, uint256, uint256, bytes32)
        );

        // Call existing submit logic
        _submitBatchComparison(
            epochId,
            windowStart,
            candleCount,
            internalCandlesHash,
            chainlinkCandlesHash,
            ohlcMaeBps,
            ohlcP95Bps,
            ohlcMaxBps,
            directionMatchBps,
            outlierCount,
            scoreBps,
            diffMerkleRoot
        );
    }

    /// @notice Internal function containing original submit logic
    function _submitBatchComparison(...) internal {
        // ... existing submitBatchComparison logic ...
    }
}
```

**Deployment Impact:**
- Constructor now requires `_forwarder` address
- Existing `submitBatchComparison()` can remain for manual calls
- Reports from CRE go through `onReport()` → `_processReport()`

---

### Task 3: Update Settlement Contract

**File:** `contracts/src/Settlement.sol`

**Changes:**
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
// ... other imports

contract Settlement is ReceiverTemplate {
    // ... existing code ...

    constructor(address _roles, address _poolReserve, address _forwarder)
        ReceiverTemplate(_forwarder)
    {
        // ... existing constructor code ...
    }

    function _processReport(bytes calldata report) internal override {
        (
            bytes32 batchId,
            bytes32 merkleRoot,
            uint256 totalPayout,
            uint256 withdrawableCap,
            uint256 windowStart,
            uint256 windowEnd
        ) = abi.decode(report, (bytes32, bytes32, uint256, uint256, uint256, uint256));

        _commitSettlementBatch(batchId, merkleRoot, totalPayout, withdrawableCap, windowStart, windowEnd);
    }

    function _commitSettlementBatch(...) internal {
        // ... existing logic ...
    }
}
```

---

### Task 4: Update PoolReserve Contract

**File:** `contracts/src/PoolReserve.sol`

**Changes:**
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
// ... other imports

contract PoolReserve is ReceiverTemplate {
    // ... existing code ...

    constructor(address _roles, address _asset, address _forwarder)
        ReceiverTemplate(_forwarder)
    {
        // ... existing constructor code ...
    }

    function _processReport(bytes calldata report) internal override {
        (
            uint256 epochId,
            uint256 poolBalance,
            uint256 totalLiability,
            uint256 utilizationBps,
            uint256 maxSingleBetExposure
        ) = abi.decode(report, (uint256, uint256, uint256, uint256, uint256));

        _reportSolvency(epochId, poolBalance, totalLiability, utilizationBps, maxSingleBetExposure);
    }

    function _reportSolvency(...) internal {
        // ... existing logic ...
    }
}
```

---

### Task 5: Update LPDistributor Contract

**File:** `contracts/src/LPDistributor.sol`

**Changes:**
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
// ... other imports

contract LPDistributor is ReceiverTemplate {
    // ... existing code ...

    constructor(address _roles, address _poolReserve, address _forwarder)
        ReceiverTemplate(_forwarder)
    {
        // ... existing constructor code ...
    }

    function _processReport(bytes calldata report) internal override {
        (
            uint256 epochId,
            uint256 amount,
            uint64 dstChainSelector,
            address receiver
        ) = abi.decode(report, (uint256, uint256, uint64, address));

        _queueDistribution(epochId, amount, dstChainSelector, receiver);
    }

    function _queueDistribution(...) internal {
        // ... existing logic ...
    }
}
```

---

### Task 6: Update StrategyManager Contract

**File:** `contracts/src/StrategyManager.sol`

**Changes:**
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
// ... other imports

contract StrategyManager is ReceiverTemplate {
    // ... existing code ...

    constructor(address _roles, address _forwarder)
        ReceiverTemplate(_forwarder)
    {
        // ... existing constructor code ...
    }

    function _processReport(bytes calldata report) internal override {
        (
            uint256 regimeId,
            uint256 fortressSpreadBps,
            uint256 maxMultiplier
        ) = abi.decode(report, (uint256, uint256, uint256));

        _setVolatilityRegime(regimeId, fortressSpreadBps, maxMultiplier);
    }

    function _setVolatilityRegime(...) internal {
        // ... existing logic ...
    }
}
```

---

### Task 7: Update Deploy Script

**File:** `contracts/script/DeployHackathon.s.sol`

**Changes:**
```solidity
// Add forwarder address parameter
address constant KEYSTONE_FORWARDER = 0x...; // Chainlink provided address

// Update deployment calls
priceIntegrity = new PriceIntegrity(address(roles), KEYSTONE_FORWARDER);
settlement = new Settlement(address(roles), address(poolReserve), KEYSTONE_FORWARDER);
poolReserve = new PoolReserve(address(roles), address(asset), KEYSTONE_FORWARDER);
lpDistributor = new LPDistributor(address(roles), address(poolReserve), KEYSTONE_FORWARDER);
strategyManager = new StrategyManager(address(roles), KEYSTONE_FORWARDER);
```

**Note:** Get the correct `KEYSTONE_FORWARDER` address from Chainlink for the target network (Sepolia/Mainnet).

---

### Task 8: Update Tests

**Files:** All `*.t.sol` test files

**Changes:**
```solidity
// Add forwarder parameter to test setups
address forwarder = makeAddr("forwarder");

// Update contract deployments in tests
priceIntegrity = new PriceIntegrity(address(roles), forwarder);

// Test onReport functionality
function test_OnReport_Success() public {
    // Prank as forwarder
    vm.prank(forwarder);
    
    // Encode report payload
    bytes memory report = abi.encode(
        epochId,
        windowStart,
        // ... other params
    );
    
    // Call onReport
    priceIntegrity.onReport(metadata, report);
    
    // Verify state changes
    assertEq(priceIntegrity.latestEpochId(), epochId);
}

function test_OnReport_InvalidSender() public {
    // Prank as non-forwarder
    vm.prank(makeAddr("attacker"));
    
    vm.expectRevert(ReceiverTemplate.InvalidSender.selector);
    priceIntegrity.onReport(metadata, report);
}
```

---

### Task 9: Update CRE Workflow Encoding

**Files:** 
- `cre/price-integrity/lib/ethereum.ts`
- `cre/settlement/lib/ethereum.ts`
- `cre/pool-solvency/lib/ethereum.ts`
- `cre/lp-distribution/lib/ethereum.ts`
- `cre/strategy-rebalance/lib/ethereum.ts`

**Changes:**
The encoding is already correct (using `encodeAbiParameters` with the same types as Solidity).

However, ensure the encoding matches exactly:
```typescript
// Price Integrity
encodeAbiParameters(
  parseAbiParameters([
    "uint256 epochId",
    "uint256 windowStart",
    "uint256 candleCount",
    "bytes32 internalCandlesHash",
    "bytes32 chainlinkCandlesHash",
    "uint256 ohlcMaeBps",
    "uint256 ohlcP95Bps",
    "uint256 ohlcMaxBps",
    "uint256 directionMatchBps",
    "uint256 outlierCount",
    "uint256 scoreBps",
    "bytes32 diffMerkleRoot",
  ]),
  [BigInt(epochId), BigInt(windowStart), ...]
);
```

---

## Security Considerations

1. **Forwarder Address**: Must be the official Chainlink KeystoneForwarder address
2. **Workflow Validation**: Optional - can validate workflow ID, name, owner
3. **Idempotency**: Contracts should handle duplicate reports gracefully
4. **Access Control**: Original functions can remain for manual/admin use

## Testing Checklist

- [ ] Unit tests for `onReport()` function
- [ ] Unit tests for `_processReport()` logic
- [ ] Access control tests (only forwarder can call)
- [ ] Integration tests with mock forwarder
- [ ] Integration tests with CRE workflow simulation
- [ ] Deploy to Sepolia and test with real forwarder

## Deployment Steps

1. Get KeystoneForwarder address from Chainlink for target network
2. Deploy updated contracts with forwarder address
3. Set up CRE workflow with new contract addresses
4. Configure workflow owner/ID validation (optional)
5. Test end-to-end with real workflow execution
6. Monitor for successful report delivery

## References

- Official Docs: https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
- ReceiverTemplate Source: (from documentation)
- IReceiver Interface: (from documentation)
