import "dotenv/config";

import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";

import { runtimeConfig } from "./config.js";
import { buildMetricJob, buildStaticMetricJob, metricNames } from "./jobs.js";
import { buildSyntheticSnapshot, metricValue } from "./worker.js";

async function main(): Promise<void> {
  const crossbar = new CrossbarClient(runtimeConfig.crossbarUrl, true);
  const useFakeMetrics = process.env.SWITCHBOARD_FAKE_METRICS !== "0";
  const syntheticSnapshot = useFakeMetrics ? buildSyntheticSnapshot() : null;

  for (const metric of metricNames) {
    const jobs: OracleJob[] = syntheticSnapshot
      ? buildStaticMetricJob(metricValue(syntheticSnapshot, metric))
      : buildMetricJob(runtimeConfig.metricsBaseUrl, metric);
    const encodedJobs = jobs.map((job) =>
      Buffer.from(OracleJob.encodeDelimited(job).finish()).toString("base64")
    );

    const response = await fetch(`${runtimeConfig.crossbarUrl}/api/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cluster: "Devnet",
        jobs: encodedJobs
      })
    });

    const body = await response.text();
    console.log(`metric=${metric}`);
    if (syntheticSnapshot) {
      console.log(`mode=synthetic-static value=${metricValue(syntheticSnapshot, metric)}`);
    } else {
      console.log(`mode=http-worker url=${runtimeConfig.metricsBaseUrl}`);
    }
    console.log(body);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
