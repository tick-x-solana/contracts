import { OracleJob } from "@switchboard-xyz/common";

import type { MetricName } from "./types.js";

export const metricNames: MetricName[] = [
  "ohlc_mae_bps",
  "ohlc_p95_bps",
  "ohlc_max_bps",
  "direction_match_bps",
  "outlier_count",
  "score_bps"
];

export function buildMetricJob(metricsBaseUrl: string, metric: MetricName): OracleJob[] {
  const url = new URL("/price-integrity", metricsBaseUrl);
  url.searchParams.set("metric", metric);

  const job = OracleJob.fromObject({
    tasks: [
      {
        httpTask: {
          url: url.toString()
        }
      },
      {
        jsonParseTask: {
          path: "$.value"
        }
      }
    ]
  });

  return [job];
}
