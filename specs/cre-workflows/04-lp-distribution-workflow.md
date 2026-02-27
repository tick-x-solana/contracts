# Workflow 4: LP Distribution (Daily Cron)

## Objective

- Allocate reserve for LP rewards and queue distribution actions on daily cadence.
- Use deterministic share calculations and idempotent writes.

## Trigger

- Type: `cron`
- Cadence: daily (recommended once per day)

## Inputs

- Distribution batch payload from app API, including `epochId` and LP share snapshot.
- Distribution policy (reward rate, destination chains, receiver addresses).
- Available reserve from `PoolReserve`.

## Flow

1. Fetch pending LP distribution batches from app API.
2. For each distribution batch:
   - load `epochId` and LP share snapshot
   - canonicalize and validate batch schema
3. Compute total distributable amount for epoch.
4. For each configured destination:
   - compute `amountForDst`
   - build queue item `(epochId, amountForDst, dstChainSelector, receiver)`
5. Reserve allocation step:
   - call `PoolReserve.allocateReserveToLPDistributor(totalAmount, distributorReceiver)`
6. Queue distribution step:
   - call `LPDistributor.queueDistribution(...)` for each destination.
7. Record tx hashes and queue ids in workflow output.

## Onchain Write Sequence

1. `PoolReserve.allocateReserveToLPDistributor(totalAmount, receiver)`
2. `LPDistributor.queueDistribution(epochId, amount, dstChainSelector, receiver)` per destination

## Idempotency and Retry

- Idempotency key: `(chainId, epochId, dstChainSelector)`.
- Pre-check destination queue existence before writing.
- If reserve allocation succeeded but some queue writes failed, rerun and skip completed items.

## Failure Handling

- Revert cases: unauthorized distributor, insufficient reserve, duplicate queue entry.
- Partial success is acceptable with idempotent reruns.
- Any reserve or queue mismatch is flagged as critical operational incident.

## PoC vs Production

- PoC: `queueDistribution` emits event as CCIP mock.
- Production extension: replace/augment queue execution with real CCIP transfer workflow.

## Acceptance Checklist

- [ ] Daily cron picks pending LP distribution batches from app API.
- [ ] Reserve is allocated exactly once per epoch.
- [ ] Distribution queue entries are created deterministically per destination.
- [ ] Duplicate processing is safe.

## Validation Checklist

- [ ] Simulate one daily app batch and verify events.
- [ ] Simulate multi-destination distribution and verify per-destination amounts.
- [ ] Simulate mid-run failure and verify idempotent recovery.
- [ ] Verify insufficient reserve path surfaces operational error.

## References

- [Cron Trigger](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/cron-trigger)
