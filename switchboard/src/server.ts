import { createServer } from "node:http";

import { runtimeConfig } from "./config.js";
import { computePriceIntegritySnapshot, metricValue } from "./worker.js";
import {
  buildStoredBatches,
  resolveSettlementWindow,
  settlementFieldNames,
  settlementFieldValue,
  type SettlementFieldName,
} from "./settlement.js";
import type { MetricName } from "./types.js";

const allowedMetrics = new Set<MetricName>([
  "ohlc_mae_bps",
  "ohlc_p95_bps",
  "ohlc_max_bps",
  "direction_match_bps",
  "outlier_count",
  "score_bps"
]);

const allowedSettlementFields = new Set<SettlementFieldName>(settlementFieldNames);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method !== "GET") {
      res.writeHead(404).end("not found");
      return;
    }

    if (url.pathname === "/price-integrity") {
      const metric = url.searchParams.get("metric") as MetricName | null;
      if (!metric || !allowedMetrics.has(metric)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid metric" }));
        return;
      }

      const snapshot = await computePriceIntegritySnapshot();
      const body = {
        metric,
        value: metricValue(snapshot, metric),
        epochId: snapshot.epochId,
        windowStart: snapshot.windowStart,
        windowEnd: snapshot.windowEnd,
        candleCount: snapshot.candleCount,
        internalCandlesHash: snapshot.internalCandlesHash,
        chainlinkCandlesHash: snapshot.chainlinkCandlesHash,
        metrics: snapshot.metrics
      };

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    if (url.pathname === "/settlement") {
      const field = url.searchParams.get("field") as SettlementFieldName | null;
      const batchIndex = Number(url.searchParams.get("batchIndex") ?? "0");
      if (!field || !allowedSettlementFields.has(field)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid settlement field" }));
        return;
      }

      const { windowStart, windowEnd } = resolveSettlementWindow();
      const batches = buildStoredBatches(windowStart, windowEnd);
      const batch = batches[batchIndex];
      if (!batch) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid batch index" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          field,
          value: settlementFieldValue(batch, field),
          batchIndex,
          selectedBatch: batch,
        })
      );
      return;
    }

    res.writeHead(404).end("not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(runtimeConfig.port, () => {
  console.log(`switchboard mock server listening on :${runtimeConfig.port}`);
});
