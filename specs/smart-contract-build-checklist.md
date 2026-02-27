# 1-Day Smart Contract Build Checklist (Hackathon PoC)

## Scope Lock (first 15 min)

- [ ] Keep only smart-contract responsibilities on-chain: price-integrity batch reports, settlement commits, solvency reports, parameter updates, LP distribution signals.
- [ ] Do not implement full real-time betting engine on-chain.
- [ ] Use mocks for Chainlink Streams/CRE/CCIP integrations (event + storage based).

## Contract Build Checklist (Core)

- [ ] Replace starter `Counter` files with domain contracts under `src/`.
- [ ] Create `src/PriceIntegrity.sol`.
- [ ] Replace single-point proof flow with 15-minute batch comparison flow (1s candles, target `900` candles per batch).
- [ ] Add `submitBatchComparison(...)` restricted to reporter. Include: `epochId`, `windowStart`, `candleCount`, `internalCandlesHash`, `chainlinkCandlesHash`, `ohlcMaeBps`, `ohlcP95Bps`, `ohlcMaxBps`, `directionMatchBps`, `outlierCount`, `scoreBps`, `diffMerkleRoot`.
- [ ] Enforce `epochId` monotonic, `candleCount > 0`, `directionMatchBps <= 10000`, `outlierCount <= candleCount`.
- [ ] Treat score/metrics as CRE outputs; do not recompute score on-chain.
- [ ] Derive and store `isPassed` + `failureFlags` from thresholds (recommended: pass if `scoreBps >= 9000` and `ohlcP95Bps <= 50`).
- [ ] Do not revert when thresholds are missed; store the report with fail flags.
- [ ] Emit `PriceIntegrityBatchReported` with pass/fail metadata.
- [ ] Create `src/PoolReserve.sol`.
- [ ] Use a single ERC20 app currency (`USDT`) as vault asset (mock token accepted for PoC).
- [ ] Add LP flow: `depositLP(amount)` mints LP shares; `withdrawLP(shares)` burns LP shares and returns assets.
- [ ] Track LP accounting (`totalLPShares`, `lpSharesOf`) with deterministic share math (bootstrap case for first LP).
- [ ] Add minimal trader flow: `depositTrader(amount)` + `claimTrader(amount)` where claim is capped by `traderWithdrawableOf`.
- [ ] Track trader balances/withdrawable separately (`traderBalanceOf`, `traderWithdrawableOf`) so trader actions do not mint/burn LP shares.
- [ ] Keep explicit `totalCollateral` metric that includes LP vault assets + trader collateral.
- [ ] Add reserve consumption hook for LP distribution: `allocateReserveToLPDistributor(amount, receiver)` restricted to `LPDistributor` role.
- [ ] Add single withdrawable setter callable by settlement authority: `setWithdrawable(account, amount)`.
- [ ] Emit events for all state-changing actions: LP deposit/withdraw, trader deposit/claim, withdrawable set, reserve allocation.
- [ ] Add `reportSolvency(epochId, poolBalance, totalLiability, utilizationBps, maxSingleBetExposure)` restricted to reporter.
- [ ] Enforce solvency ratio `poolBalance * 1e18 / totalLiability >= 1.5e18` (if liability > 0).
- [ ] Emit `SolvencyReported`.
- [ ] Create `src/Settlement.sol`.
- [ ] Add `commitSettlementBatch(batchId, merkleRoot, totalPayout, withdrawableCap, windowStart, windowEnd)` restricted to settler.
- [ ] Store committed batch metadata and emit `SettlementBatchCommitted`.
- [ ] Add simple `markPaid(account, amount)` for PoC accounting (admin-only or settler-only).
- [ ] Create `src/StrategyManager.sol`.
- [ ] Add `setVolatilityRegime(regimeId, fortressSpreadBps, maxMultiplier)` restricted to strategist.
- [ ] Emit `VolatilityRegimeChanged`.
- [ ] Create `src/LPDistributor.sol`.
- [ ] Add `queueDistribution(epochId, amount, dstChainSelector, receiver)` restricted to distributor role.
- [ ] Mock CCIP by emitting `CCIPDistributionRequested` only (no real bridge call).

## Shared/Infra Checklist

- [ ] Add role model (`owner` + reporter/settler/strategist/distributor addresses + reserve manager permissions in `PoolReserve`).
- [ ] Add custom errors for auth and invalid params.
- [ ] Skip `pause/unpause` to minimize implementation effort for hackathon PoC.
- [ ] Add `README` section documenting which integrations are mocked.

## Test Checklist (`test/`)

- [ ] `PriceIntegrity.t.sol`: auth checks, monotonic epoch, bad metric bounds, threshold-fail gets stored with flags, happy path.
- [ ] `PoolReserve.t.sol`: LP share mint/burn math, first-LP bootstrap, trader deposit/withdrawable tracking, total collateral accounting.
- [ ] `PoolReserve.t.sol`: reserve allocation to LPDistributor role, event emission assertions, auth checks.
- [ ] `PoolReserve.t.sol`: solvency pass/fail, zero-liability handling.
- [ ] `Settlement.t.sol`: batch commit persistence, duplicate batch revert, auth checks.
- [ ] `StrategyManager.t.sol`: param updates, auth checks, event emission.
- [ ] `LPDistributor.t.sol`: queue request event + auth checks.
- [ ] One integration test: commit settlement + `setWithdrawable` + trader claim + solvency report in sequence.

## Deployment Checklist (`script/`)

- [ ] Create `script/DeployHackathon.s.sol` deploying all contracts and wiring role addresses.
- [ ] Create `script/SeedDemoData.s.sol` to submit 1-2 price integrity batch reports, 1 solvency report, 1 settlement batch, LP/trader deposits, and 1 LP distribution reserve allocation event.
- [ ] Add `.env.example` with RPC URL, PK, role addresses.
- [ ] Run `forge build`, `forge test -vv`, `forge script ... --broadcast` on target testnet.

## Hour-by-Hour Plan (1 day)

- [ ] Hour 1: scope lock, contract skeletons, shared errors/events.
- [ ] Hours 2-4: implement PriceIntegrity + PoolReserve + Settlement.
- [ ] Hour 5: implement StrategyManager + LPDistributor.
- [ ] Hours 6-7: write tests for all contracts.
- [ ] Hour 8: deployment scripts + seed script.
- [ ] Hour 9: testnet deploy + smoke checks.
- [ ] Hour 10: README demo notes + final verification.

## Explicit PoC Compromises (accepted)

- [ ] No on-chain full-candle verification or score recomputation to save gas; trusted CRE reporter submits hashes + aggregate metrics + score.
- [ ] No real CCIP transfer execution; event-based mock only.
- [ ] `USDT` may be a local mock ERC20 in tests and demo deployment.
- [ ] No `pause/unpause` module in PoC scope.
- [ ] No merkle claim flow unless extra time remains.
- [ ] No upgradeability; single deploy, immutable logic for demo.

## Price Integrity Scoring Recommendation (executed in CRE, submitted on-chain)

- [ ] Compare two candle lists off-chain for the same 15-minute window; use normalized OHLC error in bps per candle:
      `err_i = (abs(Oi-Or)*10000/Or + abs(Hi-Hr)*10000/Hr + abs(Li-Lr)*10000/Lr + abs(Ci-Cr)*10000/Cr) / 4`
- [ ] Aggregate metrics from `err_i`: `ohlcMaeBps`, `ohlcP95Bps`, `ohlcMaxBps`.
- [ ] Compute direction consistency:
      `directionMatchBps = matchingSignCount(C-O) * 10000 / candleCount`.
- [ ] Compute outlier rate:
      candle is outlier if `err_i > 50`; `outlierRateBps = outlierCount * 10000 / candleCount`.
- [ ] Recommended score formula (integer math, 0..10000, computed in CRE):
      `sAcc = max(0, 10000 - ohlcMaeBps * 200)`
      `sP95 = max(0, 10000 - ohlcP95Bps * 100)`
      `sMax = max(0, 10000 - ohlcMaxBps * 50)`
      `sDir = directionMatchBps`
      `sOut = max(0, 10000 - outlierRateBps * 2)`
      `scoreBps = (5000*sAcc + 2000*sP95 + 1000*sMax + 1000*sDir + 1000*sOut) / 10000`
- [ ] Recommended pass condition:
      `scoreBps >= 9000` and `ohlcP95Bps <= 50`.
- [ ] Smart contract responsibility: store reported fields, enforce metric bounds, derive pass/fail flags, emit event.
