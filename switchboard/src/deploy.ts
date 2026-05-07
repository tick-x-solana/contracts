import "dotenv/config";

import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";
import { getDefaultDevnetQueue } from "@switchboard-xyz/on-demand";
import { PublicKey } from "@solana/web3.js";

import { runtimeConfig } from "./config.js";
import { buildMetricJob, buildStaticMetricJob, metricNames } from "./jobs.js";
import { buildSyntheticSnapshot, metricValue } from "./worker.js";

interface DeploymentResult {
  metric: string;
  feedHash: string;
  quoteAccount: string;
  verificationTx?: string;
  mockValue: number;
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
  const useFakeMetrics = process.env.SWITCHBOARD_FAKE_METRICS !== "0";
  const syntheticSnapshot = useFakeMetrics ? buildSyntheticSnapshot() : null;

  const results: DeploymentResult[] = [];

  for (const metric of metricNames) {
    const mockValue = syntheticSnapshot ? metricValue(syntheticSnapshot, metric) : 0;
    const jobs: OracleJob[] = syntheticSnapshot
      ? buildStaticMetricJob(mockValue)
      : buildMetricJob(runtimeConfig.metricsBaseUrl, metric);
    const { feedHash } = await crossbarClient.store(queue.pubkey.toBase58(), jobs);
    const quoteAccount = deriveQuoteAccount(queue.pubkey, feedHash);

    results.push({
      metric,
      feedHash,
      quoteAccount: quoteAccount.toBase58(),
      mockValue
    });
  }

  console.log(JSON.stringify({
    rpcUrl: runtimeConfig.rpcUrl,
    queue: queue.pubkey.toBase58(),
    mode: syntheticSnapshot ? "synthetic-static" : "http-worker",
    metricsBaseUrl: runtimeConfig.metricsBaseUrl,
    syntheticSnapshot,
    switchboardQuoteProgramId: QUOTE_PROGRAM_ID.toBase58(),
    feeds: results
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
