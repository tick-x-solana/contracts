import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface SettlementSwitchboardConfig {
  network: string;
  rpcUrl: string;
  queue: string;
  switchboardQuoteProgramId: string;
  mode: string;
  maxAgeSlots: number;
  feedIds: string[];
  feedIdsCsv: string;
  quoteAccount: string;
  feeds: Array<{ field: string; feedId: string }>;
}

interface SelectedBatch {
  batchId: string;
}

interface SettlementBatchFile {
  windowStart: number;
  windowEnd: number;
  batches: SelectedBatch[];
}

async function main(): Promise<void> {
  const batchIndex = Number(process.env.SETTLEMENT_BATCH_INDEX ?? "0");
  const deployConfigPath = path.resolve("deployments/settlement-switchboard-devnet.json");
  const batchConfigPath = path.resolve("deployments/settlement-devnet.json");
  const outputPath = path.resolve("deployments/settlement-switchboard-commit-devnet.json");

  const deployConfig = JSON.parse(
    await readFile(deployConfigPath, "utf8")
  ) as SettlementSwitchboardConfig;
  const batchConfig = JSON.parse(await readFile(batchConfigPath, "utf8")) as SettlementBatchFile;
  const selectedBatch = batchConfig.batches[batchIndex];

  if (!selectedBatch) {
    throw new Error(`batch index ${batchIndex} out of range`);
  }

  const payload = {
    ...deployConfig,
    batchIndex,
    generatedAt: Math.floor(Date.now() / 1000),
    windowStart: batchConfig.windowStart,
    windowEnd: batchConfig.windowEnd,
    selectedBatch,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`updated ${outputPath}`);
  console.log(`batchIndex=${batchIndex}`);
  console.log(`batchId=${selectedBatch.batchId}`);
  console.log(`quoteAccount=${deployConfig.quoteAccount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
