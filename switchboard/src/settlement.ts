import "dotenv/config";

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export type Outcome = "WIN" | "LOSE" | "DRAW" | "CANCELLED";

export interface SettlementEntry {
  account: string;
  betId: string;
  outcome: Outcome;
  payout: string;
  originalStake: string;
}

export interface PendingBatch {
  batchId: string;
  windowStart: number;
  windowEnd: number;
  settlements: SettlementEntry[];
}

export interface StoredBatch {
  batchId: string;
  merkleRoot: string;
  totalPayout: number;
  withdrawableCap: number;
  windowStart: number;
  windowEnd: number;
  settlementCount: number;
  settlements: SettlementEntry[];
}

export const settlementFieldNames = [
  "merkle_root_0",
  "merkle_root_1",
  "merkle_root_2",
  "merkle_root_3",
  "merkle_root_4",
  "merkle_root_5",
  "merkle_root_6",
  "merkle_root_7",
  "total_payout",
  "withdrawable_cap",
  "window_start",
  "window_end",
] as const;

export type SettlementFieldName = typeof settlementFieldNames[number];
export type SettlementFieldValue = string;

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

function hashBuffer(parts: Buffer[]): `0x${string}` {
  const hasher = createHash("sha256");
  for (const part of parts) hasher.update(part);
  return `0x${hasher.digest("hex")}`;
}

export function resolveSettlementWindow(): { windowStart: number; windowEnd: number } {
  const configuredStart = process.env.SIMULATION_WINDOW_START;
  const configuredEnd = process.env.SIMULATION_WINDOW_END;
  if (configuredStart && configuredEnd) {
    return { windowStart: Number(configuredStart), windowEnd: Number(configuredEnd) };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowEnd = Math.floor(now / 900) * 900;
  return { windowStart: windowEnd - 900, windowEnd };
}

export function buildMockPendingBatches(windowStart: number, windowEnd: number): PendingBatch[] {
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
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeMerkleRoot(settlements: SettlementEntry[]): `0x${string}` {
  if (settlements.length === 0) return hashHex(["empty"]);

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
  return settlements.reduce(
    (total, settlement) => (settlement.outcome === "WIN" ? total + Number(settlement.payout) : total),
    0
  );
}

function computeWithdrawableCap(settlements: SettlementEntry[]): number {
  return settlements.reduce((max, settlement) => Math.max(max, Number(settlement.payout)), 0);
}

export function buildStoredBatches(windowStart: number, windowEnd: number): StoredBatch[] {
  return buildMockPendingBatches(windowStart, windowEnd).map((batch) => {
    const settlements = canonicalSettlements(batch);
    const merkleRoot = computeMerkleRoot(settlements);
    const totalPayout = computeTotalPayout(settlements);
    const withdrawableCap = computeWithdrawableCap(settlements);
    return {
      batchId: computeBatchId(
        merkleRoot,
        totalPayout,
        withdrawableCap,
        batch.windowStart,
        batch.windowEnd
      ),
      merkleRoot,
      totalPayout,
      withdrawableCap,
      windowStart: batch.windowStart,
      windowEnd: batch.windowEnd,
      settlementCount: settlements.length,
      settlements,
    };
  });
}

function u64ToBuffer(value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  return out;
}

function computeBatchId(
  merkleRoot: string,
  totalPayout: number,
  withdrawableCap: number,
  windowStart: number,
  windowEnd: number
): `0x${string}` {
  return hashBuffer([
    Buffer.from(merkleRoot.replace(/^0x/, ""), "hex"),
    u64ToBuffer(totalPayout),
    u64ToBuffer(withdrawableCap),
    u64ToBuffer(windowStart),
    u64ToBuffer(windowEnd),
  ]);
}

function bytes32ToChunks(hexValue: string): [string, string, string, string, string, string, string, string] {
  const chunkHexWidths = [8, 8, 8, 8, 8, 8, 8, 8];
  const raw = hexValue.startsWith("0x") ? hexValue.slice(2) : hexValue;
  const chunks: string[] = [];
  let cursor = 0;
  for (const width of chunkHexWidths) {
    chunks.push(BigInt(`0x${raw.slice(cursor, cursor + width)}`).toString());
    cursor += width;
  }
  return chunks as [string, string, string, string, string, string, string, string];
}

export function settlementFieldValue(batch: StoredBatch, field: SettlementFieldName): SettlementFieldValue {
  const merkleChunks = bytes32ToChunks(batch.merkleRoot);
  switch (field) {
    case "merkle_root_0":
      return merkleChunks[0];
    case "merkle_root_1":
      return merkleChunks[1];
    case "merkle_root_2":
      return merkleChunks[2];
    case "merkle_root_3":
      return merkleChunks[3];
    case "merkle_root_4":
      return merkleChunks[4];
    case "merkle_root_5":
      return merkleChunks[5];
    case "merkle_root_6":
      return merkleChunks[6];
    case "merkle_root_7":
      return merkleChunks[7];
    case "total_payout":
      return String(batch.totalPayout);
    case "withdrawable_cap":
      return String(batch.withdrawableCap);
    case "window_start":
      return String(batch.windowStart);
    case "window_end":
      return String(batch.windowEnd);
  }
}

async function main(): Promise<void> {
  const { windowStart, windowEnd } = resolveSettlementWindow();
  const batches = buildStoredBatches(windowStart, windowEnd);
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
