import "dotenv/config";

import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";

import { runtimeConfig } from "./config.js";
import { buildMetricJob, metricNames } from "./jobs.js";

async function main(): Promise<void> {
  const crossbar = new CrossbarClient(runtimeConfig.crossbarUrl, true);

  for (const metric of metricNames) {
    const jobs: OracleJob[] = buildMetricJob(runtimeConfig.metricsBaseUrl, metric);
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
    console.log(`mode=http-worker url=${runtimeConfig.metricsBaseUrl}`);
    console.log(body);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
