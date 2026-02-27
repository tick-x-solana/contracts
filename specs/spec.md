<aside>
⛓️

**Tap a cell. Predict BTC in 5 seconds. Win up to 100x. Settled by Chainlink. Verified on-chain.**

</aside>

**Idea Pool:** [[Tap.fun](http://Tap.fun) × Chainlink](https://www.notion.so/Tap-fun-Chainlink-cc7fe1e1fdb44b0b9d992251520581dd?pvs=21) · **Sprint:** 4 days · **Mode:** $20 band / 5s window · **Based on:** [Euphoria](https://euphoria.finance/) tap-trading

---

### Overview

- **User picks a $20 price band + 5-second window** → one-touch prediction on live BTC/USDT
- **Chainlink Data Streams** via WebSocket as the price source (1s OHLC or equivalent) · used for verification and settlement
- **Chainlink CRE** runs 5 autonomous workflows: **Price Integrity Proof** (on-chain every 15min), Fair Settlement, Pool Solvency PoR, LP Distribution (CCIP), Strategy Rebalance
- **Multipliers update live** (1.2x near-spot → 100x far) — Brownian Bridge + Fortress engine
- **Provably fair** — every 15 min, CRE publishes a signed proof that [**tap.fun](http://tap.fun)'s internal price matches Chainlink reference pricing within tolerance** (public verification on-chain).

### Jobs to be Done

Go to @specs/jtbd.md

### Demo Script

Go to @specs/demo-script.md

### User Journey — Happy Path

- **Discover** → user opens app, sees live BTC/USDT price + multiplier grid
- **Pick** → user picks a $20 band and 5-second window (e.g. $96,240–260, 5–10s, 2.8x)
- **Tap** → one touch → bet placed instantly, no confirm modal
- **Lock** → server locks at next oracle tick (≤500ms) — multiplier snapshot immutable
- **Watch** → countdown, OHLC ticks stream, price enters band
- **Settle** → bet resolves off-chain for speed, then CRE batches and commits settlement results on-chain
- **Payout** → WIN: credited to in-app balance instantly; **withdrawable** updates on the next CRE settlement commit (solvency + audit window)

### Data Flow

Chainlink Data Streams (WebSocket) → Volatility Detection (EWMA + Hawkes) → Fortress Quoter (100ms ticks) → Grid render (100ms LERP) → Player tap → Server lock (oracle tick) → Off-chain settle + in-app credit → CRE batch commit (settlements + withdrawable) → Withdraw (capped to last commit)

### Acceptance Criteria

- [ ]  Single mode ($20 band / 5s window) renders correct grid with live oracle price feed
- [ ]  Bets lock with 500ms min delay, multiplier snapshot at lock time
- [ ]  Settlement matches OHLC touch within window — zero discrepancy
- [ ]  Fortress quote adjusts on liability spike ≤100ms (skew response)
- [ ]  MC pricing stable: SE ≤ 0.001 in flat market (N_min = 5,000, SE_abs = 0.001, SE_rel = 10%)
- [ ]  Price Integrity Proof publishes on-chain every 15min — checks internal price vs Chainlink reference pricing, deviation < 50bps
- [ ]  Pool Solvency PoR on-chain every 60s — solvency ratio always > 1.5x, reports: pool balance, total liability, solvency ratio, utilization %, max single-bet exposure
- [ ]  CRE batch commit publishes settlement outcomes + withdrawable caps on-chain on a fixed cadence (or on BetWindowClosed)
- [ ]  LP Distribution triggers on EpochEnded — cross-chain via CCIP
- [ ]  Strategy Rebalance adjusts Fortress params on VolRegimeChange event

### Backlogs

[Backlogs](https://www.notion.so/Backlogs-3c27d5e368564b90aeddbc2e9dbaae5c?pvs=21)

### References

- [Euphoria Finance](https://euphoria.finance/) · [Docs](https://docs.euphoria.finance/) · [X](https://x.com/Euphoria_fi)
- [Blip Market — ETHGlobal winner](https://ethglobal.com/showcase/blip-market-8edo8) (tap-trading | euphoria)
- [Live Demo](http://tap-trading-b1td.vercel.app/) · [Deck](https://docs.google.com/presentation/d/1QFmjafvQLFD6aTSC507nIJfpJyFEjNFzKDXpeMgZp7w/edit)
    
    [Tap.fun_Prediction_Gaming_Infrastructure_with_Provably_Fair_Pricing_&_Institutional-Grade_Reliability.pdf](attachment:b62ae25b-2271-4243-aca2-35f4fa494efd:Tap.fun_Prediction_Gaming_Infrastructure_with_Provably_Fair_Pricing__Institutional-Grade_Reliability.pdf)
    
- [Brownian Bridge Barrier Lemma](https://www.csie.ntu.edu.tw/~lyuu/finance1/2015/20150520.pdf) · [Broadie-Glasserman-Kou](https://www.columbia.edu/~sk75/mfBGK.pdf)
- [EWMA variance](https://arch.readthedocs.io/en/latest/univariate/generated/arch.univariate.EWMAVariance.html) · [CVaR — Rockafellar-Uryasev](https://www.pacca.info/public/files/docs/public/finance/Active%20Risk%20Management/Uryasev%20Rockafellar-%20Optimization%20CVaR.pdf)

[Product Description (Legacy)](https://www.notion.so/Product-Description-Legacy-31273065b858807898a7d87e7802fec6?pvs=21)

### Code

- **Repo:** *TBD*
- **Stack:** `Chainlink CRE` · `Data Feeds` · `CCIP` · `Base` · `EVM` · `Tenderly`
- **Market:** BTC/USDT (Binance) · **Oracle:** 1s OHLC · Render: 100ms LERP
- **Key modules:** MC engine, Brownian Bridge, EWMA + Hawkes, Fortress quoter
- **CRE Contracts:** `PriceIntegrity.sol` · `Settlement.sol` · `PoolReserve.sol` · `LPDistributor.sol` · `StrategyManager.sol`
- **CRE Docs:** [CRE Overview](https://chain.link/chainlink-runtime-environment) · [CRE SDK](https://docs.chain.link/cre/llms-full-ts.txt)

---