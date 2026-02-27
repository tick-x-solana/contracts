# Workflow 3: Pool Solvency PoR (Daily)

## Objective

- Publish periodic solvency proof-of-reserve snapshots onchain.
- Protect against stale/noisy reports with deterministic calculations.

## Trigger

- Type: `cron`
- Cadence: daily (recommended once per day)

## Inputs

- Onchain pool balance and reserve state.
- Current total liability from app API settlement risk endpoint.
- Utilization and max single-bet exposure inputs.

## Flow

1. Start daily run with target timestamp.
2. Fetch pool asset balance and reserve-related onchain values.
3. Fetch liability/exposure values from app API settlement risk source.
4. Compute:
   - `solvencyRatio = poolBalance / totalLiability` (when liability > 0)
   - `utilizationBps`
   - `maxSingleBetExposure`
5. If liability is zero, treat ratio as healthy and continue.
6. If ratio meets threshold (`>= 1.5x`), submit:
   - `PoolReserve.reportSolvency(epochId, poolBalance, totalLiability, utilizationBps, maxSingleBetExposure)`
7. If ratio below threshold:
   - do not submit report that would revert
   - emit incident telemetry/alert and mark run as critical failure.

## Onchain Write Payload

- `epochId`
- `poolBalance`
- `totalLiability`
- `utilizationBps`
- `maxSingleBetExposure`

## Idempotency and Retry

- Idempotency key: `(chainId, epochId)`.
- If report already exists for epoch, skip.
- Retry data fetch failures within run budget.
- Do not submit duplicate solvency reports.

## Failure Handling

- Revert cases: unauthorized reporter, under-threshold report, stale epoch.
- Under-threshold ratio is an operational incident condition.
- Record workflow run metadata for audit trail even when no onchain write occurs.

## Acceptance Checklist

- [ ] Runs daily.
- [ ] Healthy snapshots are written onchain.
- [ ] Under-collateralized states trigger incident path.
- [ ] Duplicate epochs are ignored safely.

## Validation Checklist

- [ ] Simulate healthy ratio and verify `SolvencyReported` event.
- [ ] Simulate zero-liability path and verify successful report.
- [ ] Simulate ratio below threshold and verify alert path without state corruption.
- [ ] Verify epoch id monotonic behavior.

## References

- [Cron Trigger](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/cron-trigger)
- [Monitoring and Debugging](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/deployments/monitoring-debugging-workflows)
