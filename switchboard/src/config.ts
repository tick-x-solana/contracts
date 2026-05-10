import "dotenv/config";

import type { WorkerConfig } from "./types.js";

export const workerConfig: WorkerConfig = {
  appApiBaseUrl: process.env.APP_API_BASE_URL ?? "https://api-tap-fun-chainlink.nysm.work/api/v1",
  appApiKey: process.env.APP_API_KEY ?? "",
  outlierThresholdBps: 50,
  minScoreBps: 9000,
  maxOhlcP95Bps: 50
};

export const runtimeConfig = {
  rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  payerKeypairPath: process.env.PAYER_KEYPAIR_PATH ?? "",
  metricsBaseUrl: process.env.METRICS_BASE_URL ?? "",
  crossbarUrl: process.env.CROSSBAR_URL ?? "https://crossbar.switchboard.xyz",
  port: Number(process.env.PORT ?? "8787")
};
