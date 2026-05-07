import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildSyntheticSnapshot, metricValue } from "./worker.js";
import { metricNames } from "./jobs.js";

interface DeploymentFile {
  syntheticSnapshot: ReturnType<typeof buildSyntheticSnapshot>;
  feeds: Record<string, { feedHash: string; quoteAccount: string; mockValue: number }>;
}

async function main(): Promise<void> {
  const deploymentPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve("deployments/price-integrity-devnet.json");

  const raw = await readFile(deploymentPath, "utf8");
  const deployment = JSON.parse(raw) as DeploymentFile & Record<string, unknown>;
  const syntheticSnapshot = buildSyntheticSnapshot();

  deployment.syntheticSnapshot = syntheticSnapshot;

  for (const metric of metricNames) {
    if (deployment.feeds?.[metric]) {
      deployment.feeds[metric].mockValue = metricValue(syntheticSnapshot, metric);
    }
  }

  await writeFile(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  console.log(`updated ${deploymentPath}`);
  console.log(`epochId=${syntheticSnapshot.epochId}`);
  console.log(`windowStart=${syntheticSnapshot.windowStart}`);
  console.log(`windowEnd=${syntheticSnapshot.windowEnd}`);
  console.log(`scoreBps=${syntheticSnapshot.metrics.scoreBps}`);
  console.log(`ohlcP95Bps=${syntheticSnapshot.metrics.ohlcP95Bps}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
