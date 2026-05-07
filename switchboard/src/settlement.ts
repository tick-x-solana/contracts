import "dotenv/config";

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

type Outcome = "WIN" | "LOSE" | "DRAW" | "CANCELLED";

interface SettlementEntry {
  account: string;
  betId: string;
  outcome: Outcome;
  payout: string;
  originalStake: string;
}

interface PendingBatch {
  batchId: string;
  windowStart: number;
  windowEnd: number;
  settlements: SettlementEntry[];
}

interface StoredBatch {
  batchId: string;
  merkleRoot: string;
  totalPayout: number;
  withdrawableCap: number;
  windowStart: number;
  windowEnd: number;
  settlementCount: number;
  settlements: SettlementEntry[];
}

function random(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

function randomHex(seed: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    Math.floor(random(seed + index) * 16).toString(16)
  ).join("");
}

function hashHex(parts: Array<string | number>): `0x${string}` {
  const value = parts.join("|");
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function resolveWindow(): { windowStart: number; windowEnd: number } {
  const configuredStart = process.env.SIMULATION_WINDOW_START;
  const configuredEnd = process.env.SIMULATION_WINDOW_END;
  if (configuredStart && configuredEnd) {
    return { windowStart: Number(configuredStart), windowEnd: Number(configuredEnd) };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowEnd = Math.floor(now / 900) * 900;
  return { windowStart: windowEnd - 900, windowEnd };
}

function buildMockPendingBatches(windowStart: number, windowEnd: number): PendingBatch[] {
  const batchCount = Math.floor(random(windowStart) * 3) + 1;

  return Array.from({ length: batchCount }, (_, batchIndex) => {
    const settlementCount = Math.floor(random(windowStart + batchIndex + 100) * 5) + 1;
    const settlements: SettlementEntry[] = Array.from({ length: settlementCount }, (_, idx) => {
      const seed = windowStart + batchIndex * 100 + idx;
      return {
        account: `0x${randomHex(seed, 40)}`,
        betId: `bet_${windowStart}_${batchIndex}_${idx}`,
        outcome: random(seed + 77) < 0.7 ? "WIN" : "LOSE",
        payout: String((Math.floor(random(seed + 88) * 5) + 1) * 100_000_000),
        originalStake: String(100_000_000),
      };
    });

    return {
      batchId: `batch_${windowStart}_${batchIndex}`,
      windowStart,
      windowEnd,
      settlements,
    };
  });
}

function canonicalSettlements(batch: PendingBatch): SettlementEntry[] {
  const sorted = [...batch.settlements].sort((a, b) =>
    `${a.account}:${a.betId}`.localeCompare(`${b.account}:${b.betId}`)
  );
  const seen = new Set<string>();
  return sorted.filter((settlement) => {
    const key = `${settlement.account}:${settlement.betId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function computeBatchId(batch: PendingBatch, settlementCount: number): `0x${string}` {
  return hashHex([batch.windowStart, batch.windowEnd, settlementCount]);
}

function computeMerkleRoot(settlements: SettlementEntry[]): `0x${string}` {
  if (settlements.length === 0) {
    return hashHex(["empty"]);
  }

  let level = settlements.map((settlement) =>
    hashHex([
      settlement.account.toLowerCase(),
      settlement.betId,
      settlement.outcome,
      settlement.payout,
      settlement.originalStake,
    ]).slice(2)
  );

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(hashHex([left, right]).slice(2));
    }
    level = next;
  }

  return `0x${level[0]}`;
}

function computeTotalPayout(settlements: SettlementEntry[]): number {
  return settlements.reduce((total, settlement) => {
    return settlement.outcome === "WIN" ? total + Number(settlement.payout) : total;
  }, 0);
}

function computeWithdrawableCap(settlements: SettlementEntry[]): number {
  return settlements.reduce((max, settlement) => Math.max(max, Number(settlement.payout)), 0);
}

async function main(): Promise<void> {
  const { windowStart, windowEnd } = resolveWindow();
  const pendingBatches = buildMockPendingBatches(windowStart, windowEnd);
  const batches: StoredBatch[] = pendingBatches.map((batch) => {
    const settlements = canonicalSettlements(batch);
    return {
      batchId: computeBatchId(batch, settlements.length),
      merkleRoot: computeMerkleRoot(settlements),
      totalPayout: computeTotalPayout(settlements),
      withdrawableCap: computeWithdrawableCap(settlements),
      windowStart: batch.windowStart,
      windowEnd: batch.windowEnd,
      settlementCount: settlements.length,
      settlements,
    };
  });

  const outputPath = path.resolve("deployments/settlement-devnet.json");
  const payload = {
    network: "devnet",
    mode: "synthetic-batches",
    generatedAt: Math.floor(Date.now() / 1000),
    windowStart,
    windowEnd,
    batches,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`updated ${outputPath}`);
  console.log(`windowStart=${windowStart}`);
  console.log(`windowEnd=${windowEnd}`);
  console.log(`batchCount=${batches.length}`);
  for (const [index, batch] of batches.entries()) {
    console.log(`batch[${index}].batchId=${batch.batchId}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
