# Demo Script — Video Production

<aside>
🎬

[**Tapl](http://Tapl) × Chainlink — Demo Video Script** · Mode 20 (Jackpot) · BTC/USDT · **Runtime: 3:20** · Hand-off ready for video editor

</aside>

**Market:** BTC/USDT (Chainlink WebSocket) · **Mode:** $20 bands · 5s windows · Multipliers 1.2x–100x

---

### Master Timeline

| **Scene** | **Start** | **End** | **Duration** | **Content** |
| --- | --- | --- | --- | --- |
| 0 · Cold Open | 0:00 | 0:08 | 8s | Hook — price, grid, tap, settle, logos |
| 1 · The Grid | 0:08 | 0:40 | 32s | Discovery — BTC price, grid explained, multipliers |
| 2 · Tap, Bet & Settle | 0:40 | 1:30 | 50s | Tap → bet placed → lock → settlement → in-app balance credit → withdrawable commit |
| 3 · Under the Hood | 1:30 | 1:55 | 25s | One diagram: off-chain flow + periodic on-chain commit via CRE |
| 4 · CRE Workflows | 1:55 | 2:50 | 55s | 5 CRE workflows, Price Integrity hero |
| 5 · Outro | 2:50 | 3:00 | 10s | Logo, tagline, CTA + verify + withdraw |
| **TOTAL** | **0:00** | **3:00** | **3m 00s** |   **• ~20s buffer for transitions = 3:20 max** |

---

## Scene 0 · Cold Open

**⏱️ 0:00 – 0:08 (8s)**

### [SCREEN]

Black → BTC ticker counting fast → grid cells flash → finger taps → WIN explosion → [Tapl](http://Tapl) + Chainlink logos

### [UI SKETCH]

```jsx
┌─────────────────────────────────┐
│         ░░ $96,247.30 ░░        │  ← price ticker
│   [2.1x] [3.4x] [5.6x] [8.2x] │  ← grid cells flash
│   [4.7x] [7.1x] [12x] [19.3x] │
│      ████ TAP ████  → 💥 WIN   │
│    Tapl  ×  ⛓️ Chainlink    │  ← logos
└─────────────────────────────────┘
```

### [VOICE + SUBTITLE]

| **Time** | **Voice** | **Subtitle** | **On Screen** |
| --- | --- | --- | --- |
| [0:00–0:08] | *"Predict BTC. Five seconds. One tap. Settled by Chainlink."* | `Predict BTC in 5 seconds. Verified on-chain.` | Fast cuts: ticker → grid → tap → WIN → logos |

### [FOCUS]

- [0:00–0:02] Black → BTC price ticker appears, counting rapidly
- [0:02–0:04] Grid cells flash in sequence with multipliers
- [0:04–0:06] Finger taps a cell → WIN explosion
- [0:06–0:08] [Tapl](http://Tapl) × Chainlink logos fade in

### [TRANSITION]  Smash cut → Scene 1

---

## Scene 1 · The Grid — Discovery

**⏱️ 0:08 – 0:40 (32s)**

### [SCREEN]

Full app view. Left: BTC/USDT live price line. Right: multiplier grid. Bottom: wallet + bet selector.

### [UI SKETCH]

```jsx
┌──────────────────────────────────────────────────────┐
│  ₿ BTC/USDT  $96,247  ▾       [🔊] [⚙️]           │
│  ⛓️ Chainlink Data Streams                         │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ~~~~~~~~~/\~~~                   5-10s  10-15s 15-20s│
│  ~~~~~~~/    \~~  ← price line   ┌─────┬─────┬─────┐│
│  ~~~~~/ ←spot    $96,260         │100x │100x │100x ││
│  ~~~~/                           ├─────┼─────┼─────┤│
│                                  │57.2x│45.1x│38.7x││
│           ● $96,247              ├─────┼─────┼─────┤│
│                                  │14.1x│ 9.8x│ 7.8x││
│                                  ├─────┼─────┼─────┤│
│                                  │⬛2.8x│3.4x│4.1x ││ ← near spot
│                                  ├─────┼─────┼─────┤│
│                                  │29.5x│22.4x│18.6x││
│                                  └─────┴─────┴─────┘│
├──────────────────────────────────────────────────────┤
│  💰 $48.00                              🎰 $1       │
└──────────────────────────────────────────────────────┘
```

### [VOICE + SUBTITLE]

| **Time** | **Voice** | **Subtitle** | **On Screen** |
| --- | --- | --- | --- |
| [0:08–0:14] | *"This is [Tapl](http://Tapl). Live BTC price, streamed from Chainlink."* | `BTC/USDT · Live from Chainlink` | Zoom on price top-left, pulse Chainlink badge (remove Binance badge) |
| [0:14–0:22] | *"The grid. Each row is a $20 price band. Each column is a 5-second window."* | `Each cell = $20 band × 5s window` | Pan to grid, highlight column [5–10s], highlight row [$96,240–260] |
| [0:22–0:28] | *"Every cell is a prediction. The number is your multiplier. Bet $1 on 14x — win $14."* | `Multiplier = your payout · Bet $1 on 14x → win $14` | Hover on 14.1x cell, tooltip: Band + Window + Multiplier |
| [0:28–0:40] | *"Near the price? Low multiplier, high chance. Far away? 100x — but BTC needs to move fast."* | `Near spot: ~1.2x · Far: up to 100x` | Glow near-spot row (1.2x) → glow far row (100x), side-by-side |

### [FOCUS]

- [0:08–0:14] Zoom BTC price → Binance + Chainlink badges pulse
- [0:14–0:22] Pan right → highlight column header → highlight row band
- [0:22–0:28] Cursor hovers 14.1x cell → tooltip appears
- [0:28–0:40] Near-spot glow vs far-spot glow → cursor moves to near-spot cell

### [TRANSITION]  Cursor moves to near-spot cell → cut to Scene 2

---

## Scene 2 · Tap, Bet & Settle

**⏱️ 0:40 – 1:20 (40s)**

### [SCREEN]

Full user journey in one flow: pick cell → tap → instant bet → server lock → countdown → window opens → OHLC touch → WIN → payout. Continuous camera, no cuts.

### [UI SKETCH — Tap → Instant Bet]

```jsx
┌──────────────────────────────────────────────────────┐
│  ₿ BTC/USDT  $96,247  ▾       [🔊] [⚙️]           │
│  ⛓️ Chainlink Data Streams                         │
├──────────────────────────────────────────────────────┤
│                          5-10s  10-15s 15-20s        │
│  ~~~~~~~~~/\~~~         ┌─────┬─────┬─────┐         │
│  ~~~~~~~/    \~~        │100x │100x │100x │         │
│  ~~~~~/ ←spot           ├─────┼─────┼─────┤         │
│                         │57.2x│45.1x│38.7x│         │
│                         ├─────┼─────┼─────┤         │
│                         │⬛2.8x│3.4x│4.1x │ ← TAP! │
│                         ├─────┼─────┼─────┤         │
│                         │29.5x│22.4x│18.6x│         │
│                         └─────┴─────┴─────┘         │
├──────────────────────────────────────────────────────┤
│  💰 $48.00        🟡 BET PLACED · ×2.8 · $1.00     │
└──────────────────────────────────────────────────────┘
```

### [UI SKETCH — Lock → Countdown → Settlement]

```jsx
┌──────────────────────────────────────────────────────┐
│  🔒 LOCKED · $96,247.30 · ×2.8 ✓                    │
│  Oracle tick #48,291 · Verified             │
│  ⏱️ Window: 5–10s  [████░] 3s left                   │
│  ─ ─ ─ $96,260 ─ ─ ─  ← upper band                  │
│              /\                                       │
│  ~~~~~~~~~~/ ←price entering band                     │
│  ─ ─ ─ $96,240 ─ ─ ─  ← lower band                  │
│  OHLC: t=7s H=96,253 L=96,247 → TOUCH ✅            │
├──────────────────────────────────────────────────────┤
│  💰 $47.00        🟢 ACTIVE · ×2.8 · Credit: $2.80 │
└──────────────────────────────────────────────────────┘
```

### [UI SKETCH — WIN]

```jsx
┌──────────────────────────────────────────────────────────┐
│              💥💥  WIN!  +$1.80  (×2.8)  💥💥            │
│  Settled by: Chainlink CRE                                │
│  Oracle: #48,296 | H=96,253 ≥ Band=96,240 ✅              │
│  ✅ Credited to in-app balance immediately                 │
│  ⛓️ Withdrawable amount committed on next CRE settlement   │
│  💰 Balance: $48.00 → $49.80                               │
└──────────────────────────────────────────────────────────┘
```

### [VOICE + SUBTITLE]

| **Time** | **Voice** | **Subtitle** | **On Screen** |
| --- | --- | --- | --- |
| [0:40–0:46] | *"I'll pick this cell — $96,240 to $96,260, next 5 to 10 seconds. 2.8x."* | `Band: $96,240–260 · Window: 5–10s · ×2.8` | Cursor moves to cell, hovers briefly showing tooltip |
| [0:46–0:50] | *"One tap. Bet placed."* | `TAP → Bet placed instantly` | Finger taps → cell flashes yellow → "BET PLACED" toast. No modal, no confirm. |
| [0:50–0:55] | *"Server locks at the next oracle tick — 500 milliseconds. Chainlink verified. Immutable."* | `🔒 Server lock: 500ms → oracle tick #48,291 · immutable` | Cell transitions yellow → green LOCKED. Oracle tick # appears. Countdown starts: 5…4…3… |
| [0:55–1:02] | *"Window open. BTC is moving. Second 7 — high hits $96,253. Inside the band."* | `Window open · OHLC #48,296: H=$96,253 ≥ Band ✅` | Price line moving, OHLC ticks stream, H touches band boundary → green flash |
| [1:02–1:08] | *"Settled. Plus $1.80. Credited to your in-app balance. Chainlink CRE — autonomous."* | `✅ WIN · +$1.80 · Credited to in-app balance` | WIN explosion full screen, payout amount prominent, CRE badge |
| [1:08–1:20] | *"Every piece is verifiable. Oracle tick, OHLC, and periodic settlement commits — on-chain. From tap to balance credit, under 15 seconds."* | `Verify: oracle tick · OHLC · settlement commits · on-chain · <15s to balance credit` | Settlement detail card: Chainlink logo + oracle ref. Balance updates $48→$49.80. Small note: "Withdrawable updates on next commit". |

### [FOCUS]

- [0:40–0:46] Cursor hovers cell → tooltip (band + window + multiplier)
- [0:46–0:50] **Core UX moment:** TAP → instant yellow flash → "BET PLACED" toast. No modal, no confirm.
- [0:50–0:55] Server lock animation (automatic, not user-initiated). Cell yellow → green LOCKED. Oracle tick #.
- [0:55–1:02] **Continuous camera:** countdown → window opens → price line moving → OHLC ticks → H touches band → green flash
- [1:02–1:08] WIN explosion — full screen, payout prominent, CRE badge
- [1:08–1:20] Pull back to settlement details + verification. Balance updates. "<15s" timer overlay.

### [TRANSITION]  Fade to dark → wireframe aesthetic → text: **"How does it work?"**

---

## Scene 3 · Under the Hood — Off-chain + On-chain

**⏱️ 1:20 – 1:55 (35s)**

### [SCREEN]

Blueprint/dark mode. Architecture diagram builds piece by piece.

### [UI SKETCH]

```jsx
┌──────────────────────────────────────────────────────────────┐
│  ┌──────────────────┐   ┌───────────────┐   ┌──────────────┐ │
│  │  ⛓️ CHAINLINK     │──▶│  🧮 VOLATILITY │──▶│  📊 FAIR     │ │
│  │  Data Streams WS  │   │  DETECTION    │   │  PRICING     │ │
│  │  (1s OHLC)        │   │  Real-time    │   │  (BB + MC)   │ │
│  └──────────────────┘   └──────┬────────┘   └──────┬───────┘ │
│                                ▼                   ▼          │
│                       ┌──────────────┐    ┌──────────────┐   │
│                       │  💰 QUOTE     │──▶│  🟦 GRID UI   │   │
│                       │  ENGINE       │    │  100ms LERP   │   │
│                       │  100ms ticks  │    └──────────────┘   │
│                       └──────┬───────┘                        │
│                              ▼                                 │
│     ┌──────────────┐  ┌────────────────┐   ┌──────────────┐  │
│     │  🏦 POOL     │◀─│  ✅ SETTLEMENT  │──▶│  ⛓️ CRE BATCH │  │
│     │  + Withdraw  │  │  (off-chain)   │   │  COMMIT       │  │
│     │  gating      │  └────────────────┘   └──────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### [VOICE + SUBTITLE]

| **Time** | **Voice** | **Subtitle** | **On Screen** |
| --- | --- | --- | --- |
| [1:20–1:24] | *"Let's look under the hood."* | `🏗️ Architecture` | Text "How does it work?" → diagram starts empty |
| [1:24–1:31] | *"BTC price streams from Chainlink — that is our single source of truth."* | `Chainlink WebSocket → verified on-chain` | Chainlink box draws in with "verified" stamp |
| [1:31–1:37] | *"Real-time volatility detection. Multipliers adjust instantly — keeping the game fair for everyone."* | `Real-time volatility detection → multipliers adjust instantly` | Volatility Detection + Fair Pricing build, animated multiplier numbers shifting |
| [1:37–1:44] | *"Multipliers update every 100 milliseconds. Fortress engine protects the pool — anti-manipulation built into every quote."* | `100ms quote updates · Fortress anti-exploit protection` | Quote Engine lights up, multiplier numbers (2.8x, 14x, 57x) flow out |
| [1:44–1:55] | *"Bets place and settle off-chain for speed. Then CRE batches and commits settlement results and withdrawable balances on-chain. Solvency is continuously published as Proof of Reserve."* | `Off-chain execution · On-chain settlement commits · Proof of Reserve` | Settlement + Fortress + Pool draw in. "Batch commit" stamp appears. |

### [FOCUS]

- [1:20–1:24] Empty canvas → "How does it work?" text
- [1:24–1:31] Binance → Chainlink boxes animate in with "verified" stamp
- [1:31–1:37] Volatility Detection + Fair Pricing build with shifting multiplier animation
- [1:37–1:44] Quote Engine → multipliers flow out, Fortress shield icon pulses
- [1:44–1:55] Settlement + Fortress + Pool. All arrows connect. Full system pulse.

### [TRANSITION]  Diagram shrinks to corner → split to CRE panels

---

## Scene 4 · Chainlink CRE Workflows

**⏱️ 1:55 – 2:50 (55s)**

### [SCREEN]

5-panel layout. Price Integrity Proof gets hero treatment (full zoom), others appear in rapid succession.

### [UI SKETCH — Price Integrity Proof (Hero Zoom)]

```jsx
┌─────────────────────────────────────────────────────────────────┐
│  ⛓️ PRICE INTEGRITY PROOF · Every 15 Minutes · On-Chain        │
│                                                                 │
│  ┌─────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │  ⛓️ CHAINLINK │      │ Chainlink    │      │ CRE DON      │  │
│  │ BTC/USDT    │─────▶│ BTC/USD      │─────▶│ BFT          │  │
│  │ $96,247.30  │      │ Data Feed    │      │ Consensus    │  │
│  └─────────────┘      │ $96,251.00   │      └──────┬───────┘  │
│                       └──────────────┘             ▼          │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  📜 PriceProof → PriceIntegrity.sol                     │  │
│  │  binancePrice: 96,247.30 | oraclePrice: 96,251.00      │  │
│  │  deviationBps: 3.8 (0.038%) | withinTolerance: ✅       │  │
│  │  🔍 Anyone can call getLatestProof() to verify          │  │
│  └─────────────────────────────────────────────────────────┘  │
│  🔒 Signed by DON · Verified by KeystoneForwarder              │
└─────────────────────────────────────────────────────────────────┘
```

### [UI SKETCH — 5-Panel Overview]

```jsx
┌────────────────────────────┬────────────────────────────┐
│  ⛓️ 1. PRICE INTEGRITY ⭐  │  ⛓️ 2. FAIR SETTLEMENT    │
│  Every 15min: Binance vs   │  On BetWindowClosed event  │
│  Oracle → proof on-chain   │  OHLC check → WIN/LOSS     │
│  → PriceIntegrity.sol      │  → Settlement.sol          │
├─────────┬──────────┬───────┴────────────────────────────┤
│ ⛓️ 3.   │ ⛓️ 4.    │ ⛓️ 5. STRATEGY REBALANCE         │
│ POOL PoR│ LP DIST. │ On VolRegimeChange event           │
│ Every   │ On epoch │ Adjust Fortress params              │
│ 60s     │ CCIP pay │ → StrategyManager.sol               │
└─────────┴──────────┴────────────────────────────────────┘
```

### [VOICE + SUBTITLE]

| **Time** | **Voice** | **Subtitle** | **On Screen** |
| --- | --- | --- | --- |
| [1:55–2:00] | *"Chainlink CRE runs five autonomous workflows. Let's start with the most important."* | `⛓️ 5 Chainlink CRE Workflows` | 5-panel layout appears → Panel 1 zooms to full screen |
| [2:00–2:12] | *"Every 15 minutes, a CRE workflow fetches BTC from Binance API. Then reads Chainlink's BTC/USD Data Feed. Compares them — computes deviation — publishes a signed proof on-chain."* | `Price Integrity: Binance API → Chainlink Oracle → deviation → proof on-chain every 15min` | Animate: Binance → Chainlink → comparison → proof struct fields appear |
| [2:12–2:20] | *"This proof is public. Anyone can call the contract and verify: is [Tapl](http://Tapl) using the real price? On-chain, every 15 minutes. No trust required."* | `Public proof · Anyone can verify · getLatestProof() → deviation: 3.8 bps ✅` | PriceProof struct highlighted, "Anyone can verify ✅" stamp |
| [2:20–2:27] | *"Workflow two — Fair Settlement. When your window ends, CRE reads OHLC candles, determines WIN or LOSS, triggers payout. Autonomous."* | `WF2: Fair Settlement — autonomous bet resolution via CRE` | Camera pulls back, Panel 2 lights up with flow animation + ✅ |
| [2:27–2:34] | *"Three — Pool Solvency. Every 60 seconds, CRE checks pool balance versus outstanding liabilities. Published on-chain. Always auditable."* | `WF3: Pool PoR — solvency verified every 60s, on-chain` | Panel 3 lights up + ✅ |
| [2:34–2:40] | *"Four — LP Distribution. House profits get split pro-rata and distributed via CCIP — LPs can be on any chain."* | `WF4: LP Distribution — cross-chain payouts via CCIP` | Panel 4 lights up + ✅ |
| [2:40–2:45] | *"Five — Strategy Rebalance. Vol spikes, CRE adjusts Fortress parameters automatically."* | `WF5: Strategy Rebalance — auto param adjustment on vol events` | Panel 5 lights up + ✅ |
| [2:45–2:50] | *"Five workflows. Decentralized oracle networks. BFT consensus. All on-chain."* | `5 workflows · BFT consensus · All on-chain` | All 5 panels glow simultaneously |

### [FOCUS]

- [1:55–2:00] 5-panel layout → Panel 1 zooms full screen
- [2:00–2:20] **Hero moment:** Price Integrity flow animates. Binance → Oracle → deviation → proof. Let it breathe.
- [2:20–2:45] Camera pulls back. Panels 2–5 light up rapid succession (~6s each)
- [2:45–2:50]

### [TRANSITION]  All panels pulse → fade to dark → logos center

---

## Scene 5 · Outro

**⏱️ 2:50 – 3:00 (10s)**

### [SCREEN]

Dark background. [Tapl](http://Tapl) × Chainlink logos. Stats fade in. CTA.

### [UI SKETCH]

```jsx
┌──────────────────────────────────┐
│         Tapl × ⛓️            │
│                                  │
│    📊 BTC/USDT from Binance     │
│    ⛓️ Settled by Chainlink CRE  │
│    🔒 Price Integrity on-chain  │
│    🏦 Fortress-protected pool   │
│                                  │
│    Predict. Verify. Win.         │
│                                  │
\[Try the Demo\] ’ ‘Read Docs’
└──────────────────────────────────┘
```

### [VOICE + SUBTITLE]

| **Time** | **Voice** | **Subtitle** | **On Screen** |
| --- | --- | --- | --- |
| [2:50–2:57] | *"[Tapl](http://Tapl). Predict BTC in five seconds. Settled by Chainlink. Verified on-chain."* | `Predict. Verify. Win.` | Logos → stats fade in (0.5s each) → tagline |
| [2:57–3:00] | *(silence)* | *(none)* | CTA buttons glow: [Try the Demo] [Read Docs] |

---

## Production Notes

<aside>
📋

**For the video editor:**

</aside>

### Visual Style

- **App UI (Scenes 0–2):** Dark theme, pink/magenta accents (Euphoria aesthetic)
- **Architecture (Scene 3):** Blueprint/wireframe dark mode, glowing nodes
- **CRE (Scene 4):** Clean panels, Chainlink blue accents

### Audio

- **Background:** Low electronic beat, builds during betting, climax at WIN, steady for tech scenes
- **SFX:** Oracle tick beep (1/s), lock click, win chime + bass, terminal typing sounds

### Typography

- **Subtitles:** Clean sans-serif, bottom center, white on semi-transparent black bar. Timed to table above.
- **Technical:** Monospace for oracle ticks, tx hashes, prices
- **Multipliers:** Bold, large — green for low risk, orange for high

### Pacing Summary

| **Segment** | **Scenes** | **Duration** | **Pace** |
| --- | --- | --- | --- |
| Hook | 0 | 8s | Fast, energetic |
| User Journey | 1–2 | 72s | Medium — let viewer follow |
| Tech Deep Dive | 3–4 | 90s | Steady, deliberate |
| Close | 5 | 10s | Clean, calm |
| **Total** | **0–5** | **3m 00s + 20s buffer** | **Max 3:20** |

### Assets Needed

- [Tapl](http://Tapl) logo (dark + light)
- Chainlink logo + ⛓️ icon
- Binance logo (small badge)
- Sound pack (oracle tick, lock click, win chime)
- Screen recordings of actual app (when available)
- Euphoria reference screenshots for style guide

### Removed Scenes

- ~~Scene 6 (House vs Players / Fortress Simulation)~~ — removed. Do **not** expose -EV outcomes or player loss strategies. Platform solvency is communicated through CRE PoR (Scene 4) instead.

### References

- [Euphoria testnet](https://euphoria.finance/) for UI reference
- [Blip Market — ETHGlobal](https://ethglobal.com/showcase/blip-market-8edo8) for concept reference
- [CRE Docs](https://docs.chain.link/cre) for workflow accuracy