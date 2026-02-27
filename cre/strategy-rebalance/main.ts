// ==========================================================================
// Workflow 5: Strategy Rebalance (HTTP Trigger)
// ==========================================================================
//
// This workflow:
// 1. Triggers via HTTP POST request
// 2. Authenticates request using API key
// 3. Validates payload (regimeId, fortressSpreadBps, maxMultiplier)
// 4. Checks for no-op (same as current regime)
// 5. Checks idempotency (regimeId already exists)
// 6. Updates strategy on-chain via StrategyManager.setVolatilityRegime()
// 7. Logs update via API
//
// Trigger: HTTP POST
// Contract: StrategyManager.setVolatilityRegime(...)

import {
  HTTPCapability,
  handler,
  type Runtime,
  type HTTPPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type EvmConfig, type StrategyUpdateRequest, type StrategyUpdateResult, getEvmConfig, strategyUpdateRequestSchema } from "./types";
import { createApiClient } from "./lib/api";
import { setVolatilityRegime, readCurrentRegime, regimeExists, withRetry } from "./lib/ethereum";

// ========================================
// Request Validation
// ========================================

const validateRequest = (data: unknown): StrategyUpdateRequest => {
  const result = strategyUpdateRequestSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Validation failed: ${errors}`);
  }
  return result.data;
};

// ========================================
// Authentication
// ========================================

const authenticate = async (
  apiClient: ReturnType<typeof createApiClient>,
  apiKey: string
): Promise<boolean> => {
  return apiClient.validateApiKey(apiKey);
};

// ========================================
// No-Op Detection
// ========================================

const isNoOp = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  request: StrategyUpdateRequest
): Promise<boolean> => {
  const currentRegime = await withRetry(() => readCurrentRegime(runtime, evmConfig));
  
  if (!currentRegime) {
    return false; // No current regime, not a no-op
  }
  
  // Check if parameters are the same
  return (
    currentRegime.fortressSpreadBps === request.fortressSpreadBps &&
    currentRegime.maxMultiplier === request.maxMultiplier
  );
};

// ========================================
// HTTP Trigger Handler
// ========================================

const onHttpTrigger = async (
  runtime: Runtime<Config>,
  payload: HTTPPayload
): Promise<string> => {
  const triggerTime = new Date().toISOString();

  runtime.log("========================================");
  runtime.log("Strategy Rebalance Workflow Started");
  runtime.log(`Trigger time: ${triggerTime}`);
  runtime.log("========================================");

  try {
    // ========================================
    // Step 1: Parse HTTP Payload
    // ========================================

    let requestData: unknown;
    try {
      // Parse input from bytes
      const inputString = new TextDecoder().decode(payload.input);
      requestData = JSON.parse(inputString);
      runtime.log(`Received request: ${inputString}`);
    } catch (error) {
      throw new Error("Invalid JSON in request body");
    }

    // ========================================
    // Step 2: Validate Request
    // ========================================

    runtime.log("Validating request...");
    const request = validateRequest(requestData);
    runtime.log(`Request validated: regimeId=${request.regimeId}, spread=${request.fortressSpreadBps}, multiplier=${request.maxMultiplier}`);

    // ========================================
    // Step 3: Authenticate
    // ========================================

    const apiKey = request.apiKey;
    const apiClient = createApiClient(
      runtime.config.appApiBaseUrl,
      apiKey,
      runtime.config.appApiBaseUrl.includes("localhost")
    );

    runtime.log("Authenticating request...");
    const isAuthenticated = await authenticate(apiClient, apiKey);
    if (!isAuthenticated) {
      throw new Error("Authentication failed: invalid API key");
    }
    runtime.log("Authentication successful");

    // ========================================
    // Step 4: Check Idempotency
    // ========================================

    const evmConfig = getEvmConfig(runtime.config);
    
    runtime.log("Checking idempotency...");
    const exists = await withRetry(() => regimeExists(runtime, evmConfig, request.regimeId));
    if (exists) {
      runtime.log(`Regime ${request.regimeId} already exists. Skipping.`);
      const result: StrategyUpdateResult = {
        success: true,
        regimeId: request.regimeId,
        isNoOp: true,
      };
      return JSON.stringify(result);
    }

    // ========================================
    // Step 5: No-Op Detection
    // ========================================

    runtime.log("Checking for no-op update...");
    const noOp = await isNoOp(runtime, evmConfig, request);
    if (noOp) {
      runtime.log("No-op detected: parameters match current regime. Skipping.");
      const result: StrategyUpdateResult = {
        success: true,
        regimeId: request.regimeId,
        isNoOp: true,
      };
      return JSON.stringify(result);
    }

    // ========================================
    // Step 6: Update Strategy On-Chain
    // ========================================

    runtime.log("Updating volatility regime on-chain...");
    const txHash = setVolatilityRegime(runtime, evmConfig, {
      regimeId: request.regimeId,
      fortressSpreadBps: request.fortressSpreadBps,
      maxMultiplier: request.maxMultiplier,
    });

    // ========================================
    // Step 7: Log Update via API
    // ========================================

    runtime.log("Logging strategy update...");
    try {
      await apiClient.logStrategyUpdate(
        request.regimeId,
        request.fortressSpreadBps,
        request.maxMultiplier,
        txHash
      );
      runtime.log("Strategy update logged");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.log(`Warning: Failed to log strategy update: ${message}`);
      // Non-critical error, continue
    }

    // ========================================
    // Step 8: Return Result
    // ========================================

    const result: StrategyUpdateResult = {
      success: true,
      regimeId: request.regimeId,
      txHash,
      isNoOp: false,
    };

    runtime.log("========================================");
    runtime.log("Strategy Rebalance Workflow Completed");
    runtime.log(`Regime ${request.regimeId} updated`);
    runtime.log(`Transaction: ${txHash}`);
    runtime.log("========================================");

    return JSON.stringify(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.log(`ERROR: ${message}`);
    
    const result: StrategyUpdateResult = {
      success: false,
      regimeId: 0,
      error: message,
      isNoOp: false,
    };
    
    return JSON.stringify(result);
  }
};

// ========================================
// Workflow Initialization
// ========================================

const initWorkflow = (config: Config) => {
  console.log("Initializing Strategy Rebalance Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  // HTTP trigger - listens for POST requests
  const httpCapability = new HTTPCapability();
  const httpTrigger = httpCapability.trigger({
    // For local simulation, no authorized keys required
    // In production, add public keys for request validation
    authorizedKeys: [],
  });

  return [handler(httpTrigger, onHttpTrigger)];
};

// ========================================
// Entry Point
// ========================================

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
