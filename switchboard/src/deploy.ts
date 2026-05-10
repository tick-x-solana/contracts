import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";
import { getDefaultDevnetQueue } from "@switchboard-xyz/on-demand";
import { PublicKey } from "@solana/web3.js";

import { runtimeConfig } from "./config.js";
import { buildMetricJob, metricNames } from "./jobs.js";

interface DeploymentResult {
  metric: string;
  feedHash: string;
  quoteAccount: string;
}

const QUOTE_PROGRAM_ID = new PublicKey("orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz");

function deriveQuoteAccount(queue: PublicKey, feedHashHex: string): PublicKey {
  const normalized = feedHashHex.startsWith("0x") ? feedHashHex.slice(2) : feedHashHex;
  const feedHashBytes = Buffer.from(normalized, "hex");
  if (feedHashBytes.length !== 32) {
    throw new Error(`invalid feed hash length for ${feedHashHex}`);
  }

  return PublicKey.findProgramAddressSync([queue.toBuffer(), feedHashBytes], QUOTE_PROGRAM_ID)[0];
}

async function main(): Promise<void> {
  const queue = await getDefaultDevnetQueue(runtimeConfig.rpcUrl);
  const crossbarClient = new CrossbarClient(runtimeConfig.crossbarUrl, true);

  const results: DeploymentResult[] = [];

  for (const metric of metricNames) {
    const jobs: OracleJob[] = buildMetricJob(runtimeConfig.metricsBaseUrl, metric);
    const { feedHash } = await crossbarClient.store(queue.pubkey.toBase58(), jobs);
    const quoteAccount = deriveQuoteAccount(queue.pubkey, feedHash);

    results.push({
      metric,
      feedHash,
      quoteAccount: quoteAccount.toBase58()
    });
  }

  const feedIds = results.map((result) => result.feedHash);
  const quoteAccount = PublicKey.findProgramAddressSync(
    [
      queue.pubkey.toBuffer(),
      ...feedIds.map((feedId) => {
        const normalized = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
        return Buffer.from(normalized, "hex");
      })
    ],
    QUOTE_PROGRAM_ID
  )[0];

  const deployment = {
    network: "devnet",
    rpcUrl: runtimeConfig.rpcUrl,
    queue: queue.pubkey.toBase58(),
    switchboardQuoteProgramId: QUOTE_PROGRAM_ID.toBase58(),
    mode: "http-worker",
    maxAgeSlots: 30,
    metricsBaseUrl: runtimeConfig.metricsBaseUrl,
    quoteAccount: quoteAccount.toBase58(),
    feedIds,
    feedIdsCsv: feedIds.join(","),
    feeds: Object.fromEntries(results.map((result) => [result.metric, {
      feedHash: result.feedHash,
      quoteAccount: result.quoteAccount
    }]))
  };

  const outputPath = path.resolve("deployments", "price-integrity-prod-devnet.json");
  await writeFile(outputPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  console.log(`updated ${outputPath}`);
  console.log(`queue=${deployment.queue}`);
  console.log(`quoteAccount=${deployment.quoteAccount}`);
  console.log(`mode=${deployment.mode}`);
  console.log(`feedCount=${deployment.feedIds.length}`);
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
