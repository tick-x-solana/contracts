# Workflow 1: Price Integrity (15m Batch OHLC Compare)

## Objective

- Compare internal app OHLC candles vs Chainlink reference candles every 15 minutes.
- Compute matching metrics and score inside CRE.
- Store results onchain with `isPassed` and `failureFlags`.

## Trigger

- Type: `cron`
- Cadence: every 15 minutes
- Window: previous closed 15-minute interval (`900` x `1s` candles expected)

## Inputs

- Internal app OHLC API (1s candles, `[ts, o, h, l, c]`).
- Chainlink reference OHLC API/adapter (1s candles, same schema).
- Workflow config: score thresholds and metric bounds.

## Flow

1. Resolve target window `[windowStart, windowEnd)`.
2. Fetch both candle lists in parallel.
3. Canonicalize:
   - dedupe by second
   - sort ascending by timestamp
   - align timestamps across both lists
4. Validate shape and bounds (`candleCount > 0`).
5. Compute per-candle normalized OHLC error in bps:
   - `err_i = (abs(Oi-Or)*10000/Or + abs(Hi-Hr)*10000/Hr + abs(Li-Lr)*10000/Lr + abs(Ci-Cr)*10000/Cr) / 4`
6. Compute aggregates:
   - `ohlcMaeBps`, `ohlcP95Bps`, `ohlcMaxBps`, `directionMatchBps`, `outlierCount`
7. Compute `scoreBps` in CRE using agreed formula.
8. Derive contract flags:
   - `isPassed = scoreBps >= 9000 && ohlcP95Bps <= 50`
   - `failureFlags` bitmask (example):
     - bit0: low score
     - bit1: high p95
     - bit2: candle count mismatch
     - bit3: data gap detected
9. Compute hashes:
   - `internalCandlesHash`
   - `chainlinkCandlesHash`
   - `diffMerkleRoot` (optional compact proof root)
10. Submit onchain report calling `PriceIntegrity.submitBatchComparison(...)`.

## Onchain Write Payload

- `epochId`
- `windowStart`
- `candleCount`
- `internalCandlesHash`
- `chainlinkCandlesHash`
- `ohlcMaeBps`
- `ohlcP95Bps`
- `ohlcMaxBps`
- `directionMatchBps`
- `outlierCount`
- `scoreBps`
- `isPassed`
- `failureFlags`
- `diffMerkleRoot`

## Idempotency and Retry

- Idempotency key: `(chainId, epochId)`.
- Before write, read finalized chain state; if epoch already stored, skip.
- Retry transient network/API failures with bounded retries.
- Do not generate a second report for same epoch on success.

## Failure Handling

- Revert cases (contract-level): unauthorized reporter, stale/duplicate epoch, invalid bounds.
- Threshold miss is not a revert case; report is stored with fail flags.
- If one source API is unavailable, emit workflow error and retry within same run budget.

## Acceptance Checklist

- [ ] Runs every 15 minutes and processes a closed window.
- [ ] CRE computes metrics and score, contract does not recompute score.
- [ ] Onchain submission stores both pass and fail windows.
- [ ] `PriceIntegrityBatchReported` includes pass/fail metadata.

## Validation Checklist

- [ ] Simulate workflow with matched sample data and confirm `isPassed = true`.
- [ ] Simulate workflow with degraded sample data and confirm `isPassed = false` stored.
- [ ] Verify duplicate epoch protection works.
- [ ] Verify hashes are deterministic for same input dataset.

## References

- [Cron Trigger](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/cron-trigger)
- [HTTP Trigger Overview](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/http-trigger-overview)
- [Non-Determinism Guidance](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/concepts/non-determinism-in-workflows)
- [Onchain Report Submission](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/onchain-write/evm/submit-reports-onchain)
