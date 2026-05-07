import "dotenv/config";

import { createHash } from "node:crypto";
import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";
import { getDefaultDevnetQueue } from "@switchboard-xyz/on-demand";
import { PublicKey } from "@solana/web3.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { runtimeConfig } from "./config.js";
import {
  buildStoredBatches,
  resolveSettlementWindow,
  settlementFieldNames,
  settlementFieldValue,
  type SettlementFieldName,
  type SettlementFieldValue,
} from "./settlement.js";

const QUOTE_PROGRAM_ID = new PublicKey("orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz");

function buildStaticFieldJob(value: SettlementFieldValue): OracleJob[] {
  return [
    OracleJob.fromObject({
      tasks: [{ valueTask: { big: value } }],
    }),
  ];
}

function buildHttpFieldJob(baseUrl: string, field: SettlementFieldName, batchIndex: number): OracleJob[] {
  const url = new URL("/settlement", baseUrl);
  url.searchParams.set("field", field);
  url.searchParams.set("batchIndex", String(batchIndex));
  return [
    OracleJob.fromObject({
      tasks: [
        { httpTask: { url: url.toString() } },
        { jsonParseTask: { path: "$.value" } },
      ],
    }),
  ];
}

function deriveQuoteAccount(queue: PublicKey, feedIds: string[]): PublicKey {
  const hasher = createHash("sha256");
  for (const feedId of feedIds) {
    const normalized = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
    hasher.update(Buffer.from(normalized, "hex"));
  }
  const feedIdsHash = hasher.digest();
  return PublicKey.findProgramAddressSync([queue.toBuffer(), feedIdsHash], QUOTE_PROGRAM_ID)[0];
}

async function main(): Promise<void> {
  const queue = await getDefaultDevnetQueue(runtimeConfig.rpcUrl);
  const crossbarClient = new CrossbarClient(runtimeConfig.crossbarUrl, true);
  const useFake = process.env.SWITCHBOARD_FAKE_METRICS !== "0";
  const batchIndex = Number(process.env.SETTLEMENT_BATCH_INDEX ?? "0");
  const { windowStart, windowEnd } = resolveSettlementWindow();
  const batches = buildStoredBatches(windowStart, windowEnd);
  const selectedBatch = batches[batchIndex];
  if (!selectedBatch) {
    throw new Error(`batch index ${batchIndex} out of range`);
  }

  const feeds: Record<string, { feedHash: string; quoteAccount: string; mockValue: SettlementFieldValue }> = {};
  const feedIds: string[] = [];
  for (const field of settlementFieldNames) {
    const mockValue = settlementFieldValue(selectedBatch, field);
    const jobs = useFake
      ? buildStaticFieldJob(mockValue)
      : buildHttpFieldJob(runtimeConfig.metricsBaseUrl, field, batchIndex);
    const { feedHash } = await crossbarClient.store(queue.pubkey.toBase58(), jobs);
    feedIds.push(feedHash);
    feeds[field] = {
      feedHash,
      quoteAccount: deriveQuoteAccount(queue.pubkey, [feedHash]).toBase58(),
      mockValue,
    };
  }

  const quoteAccount = deriveQuoteAccount(queue.pubkey, feedIds);
  const payload = {
    network: "devnet",
    rpcUrl: runtimeConfig.rpcUrl,
    queue: queue.pubkey.toBase58(),
    switchboardQuoteProgramId: QUOTE_PROGRAM_ID.toBase58(),
    mode: useFake ? "synthetic-static" : "http-worker",
    maxAgeSlots: 30,
    feedIds,
    feedIdsCsv: feedIds.join(","),
    quoteAccount: quoteAccount.toBase58(),
    selectedBatch,
    feeds,
  };
  const outputPath = path.resolve("deployments/settlement-switchboard-devnet.json");
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`updated ${outputPath}`);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
