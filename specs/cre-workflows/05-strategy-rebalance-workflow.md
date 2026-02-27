# Workflow 5: Strategy Rebalance (Volatility Regime Change)

## Objective

- Update strategy parameters in `StrategyManager` when volatility regime changes.
- Keep updates deterministic, authenticated, and idempotent.

## Trigger

- PoC trigger type: `http trigger`
- Endpoint receives signed regime-change events from risk engine:
  - `regimeId`
  - `fortressSpreadBps`
  - `maxMultiplier`
  - `effectiveTs`

## Inputs

- Regime-change payload from risk engine.
- Current strategy state snapshot from app API.
- Workflow policy (allowed param ranges, signer allowlist).

## Flow

1. Receive HTTP request on CRE trigger endpoint.
2. Authenticate request (signature/API key allowlist).
3. Validate payload schema and value ranges.
4. Canonicalize payload and compute idempotency key.
5. Fetch current strategy state from app API.
6. If payload equals app API current state, skip write (no-op).
7. Otherwise call:
   - `StrategyManager.setVolatilityRegime(regimeId, fortressSpreadBps, maxMultiplier)`
8. Emit success telemetry with tx hash and applied regime.

## Onchain Write Payload

- `regimeId`
- `fortressSpreadBps`
- `maxMultiplier`

## Idempotency and Retry

- Idempotency key: `(chainId, regimeId, fortressSpreadBps, maxMultiplier)`.
- Duplicate payloads are skipped safely.
- Retries allowed for transient write errors with bounded attempts.

## Failure Handling

- Revert cases: unauthorized strategist role, invalid params.
- Auth failure on HTTP trigger should terminate run without write.
- Out-of-range payload values are rejected before onchain write.

## PoC vs Production

- PoC: HTTP trigger from risk engine is fastest to ship.
- Production extension: move to `evm log trigger` on `VolRegimeChange` event from an onchain signal emitter.

## Acceptance Checklist

- [ ] Authenticated regime events trigger workflow.
- [ ] No-op update is skipped when payload matches app API current state.
- [ ] Valid updates write exactly once.
- [ ] Unauthorized or malformed requests are rejected.

## Validation Checklist

- [ ] Simulate valid regime event and verify `VolatilityRegimeChanged`.
- [ ] Replay same payload and verify no duplicate write.
- [ ] Simulate bad signature and confirm no write.
- [ ] Simulate out-of-range params and confirm pre-write rejection.

## References

- [HTTP Trigger Overview](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/http-trigger-overview)
- [Service Quotas](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/cre-service-quotas)
