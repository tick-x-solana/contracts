import type { OhlcResponse } from "./types.js";

export async function fetchOhlcCandles(
  apiBaseUrl: string,
  apiKey: string,
  windowStart: number,
  windowEnd: number,
  source: "internal" | "chainlink"
): Promise<OhlcResponse> {
  const url = new URL(`${apiBaseUrl}/ohlc`);
  url.searchParams.set("windowStart", String(windowStart));
  url.searchParams.set("windowEnd", String(windowEnd));
  url.searchParams.set("source", source);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url.toString()}`);
  }

  return (await response.json()) as OhlcResponse;
}
