# Workflow 2: Settlement (15m Cron Batch Commit)

## Objective

- Consume app-provided 15-minute settlement batches (deposits, withdrawals, settled win/lose orders).
- Deterministically compute batch outputs and call:
  - `commitSettlementBatch(bytes32 batchId, bytes32 merkleRoot, uint256 totalPayout, uint256 withdrawableCap, uint256 windowStart, uint256 windowEnd)`

## Trigger Design

Use a single cron-triggered workflow.

## Trigger

- Type: `cron`
- Cadence: every 15 minutes (aligned to app batch cycle)

## Inputs (from app API)

- Batch envelope:
  - `batchId`
  - `windowStart`, `windowEnd`
  - deposits list
  - withdrawals list
  - settled orders list with win/lose outcomes and payout amounts
- Optional precomputed hints from app (CRE still recomputes canonical outputs before onchain commit).

## Flow

1. Fetch pending batches for current tick from app API.
2. For each batch:
   - canonicalize all records (sort by deterministic key, dedupe)
   - validate schema and window boundaries
   - derive per-account net settlement state
3. Build merkle leaves deterministically from canonical per-account outcomes.
4. Compute:
   - `merkleRoot`
   - `totalPayout`
   - `withdrawableCap`
5. Submit onchain:
   - `Settlement.commitSettlementBatch(batchId, merkleRoot, totalPayout, withdrawableCap, windowStart, windowEnd)`
6. Mark batch as committed in app API with tx hash.

## Onchain Write Sequence

1. `Settlement.commitSettlementBatch(batchId, merkleRoot, totalPayout, withdrawableCap, windowStart, windowEnd)`

Note: per-account `setWithdrawable` updates are intentionally out of this workflow and can run in a separate follow-up workflow if needed.

## Idempotency and Retry

- Idempotency key: `(chainId, batchId)`.
- Before commit, read finalized contract state:
  - if `batchId` already committed, skip and mark API batch as committed.
- Retry transient API/RPC failures with bounded attempts.
- Re-processing same cron tick must be safe.

## Failure Handling

- Revert cases: unauthorized caller, duplicate batch id, invalid params.
- API unavailable: skip write for that batch, keep pending, retry next cron tick.
- Partial run failure: committed batches are skipped on rerun by idempotency check.

## Acceptance Checklist

- [ ] Cron runs every 15 minutes and picks pending app batches.
- [ ] `commitSettlementBatch(...)` is called once per `batchId`.
- [ ] Replayed cron runs do not create duplicate commits.

## Validation Checklist

- [ ] Simulate one full 15-minute batch and verify onchain commit fields.
- [ ] Replay same batch and verify duplicate commit is skipped.
- [ ] Simulate API outage and verify batch remains pending then succeeds on retry.

## References

- [Cron Trigger](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/cron-trigger)
- [Trigger and Callback Model](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/trigger-and-callback)
