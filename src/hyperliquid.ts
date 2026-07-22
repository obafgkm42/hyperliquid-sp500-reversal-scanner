import type { Candle } from "./types";

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const REQUEST_LOOKBACK_MS = 18 * 60 * 60 * 1_000;
const MAX_CANDLE_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const RATE_LIMIT_STATUS = 429;

interface HyperliquidCandle {
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
}

export class HyperliquidRateLimitError extends Error {
  constructor(status: number) {
    super(`Hyperliquid candle request failed: ${status}`);
    this.name = "HyperliquidRateLimitError";
  }
}

/**
 * Fetch recent five-minute candles from Hyperliquid's public info endpoint.
 */
export async function fetchFiveMinuteCandles(
  coin: string,
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<Candle[]> {
  const endTime = now.getTime();
  const response = await fetchCandlesWithRetry(coin, endTime, fetcher);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Hyperliquid candle response is invalid");
  }
  return payload.map(parseCandle).filter(
    // Ignore the candle still forming at scan time.
    (candle) => candle.endTime < endTime,
  );
}

async function fetchCandlesWithRetry(
  coin: string,
  endTime: number,
  fetcher: typeof fetch,
): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_CANDLE_REQUEST_ATTEMPTS; attempt += 1) {
    const response = await fetcher(HYPERLIQUID_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin,
          interval: "5m",
          startTime: endTime - REQUEST_LOOKBACK_MS,
          endTime,
        },
      }),
    });
    if (response.ok) {
      return response;
    }
    lastStatus = response.status;
    if (!isTransientStatus(response.status)) {
      throw new Error(`Hyperliquid candle request failed: ${response.status}`);
    }
    if (attempt < MAX_CANDLE_REQUEST_ATTEMPTS) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  if (lastStatus === RATE_LIMIT_STATUS) {
    throw new HyperliquidRateLimitError(lastStatus);
  }
  throw new Error(`Hyperliquid candle request failed: ${lastStatus}`);
}

function isTransientStatus(status: number): boolean {
  return status === RATE_LIMIT_STATUS || status >= 500;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseCandle(value: unknown): Candle {
  if (!isHyperliquidCandle(value)) {
    throw new Error("Hyperliquid returned a malformed candle");
  }
  const candle = {
    startTime: value.t,
    endTime: value.T,
    open: Number(value.o),
    high: Number(value.h),
    low: Number(value.l),
    close: Number(value.c),
    volume: Number(value.v),
    tradeCount: value.n,
  };
  if (
    !Object.values(candle).every(Number.isFinite) ||
    candle.low > candle.high ||
    candle.open < candle.low ||
    candle.open > candle.high ||
    candle.close < candle.low ||
    candle.close > candle.high
  ) {
    throw new Error("Hyperliquid candle values are invalid");
  }
  return candle;
}

function isHyperliquidCandle(value: unknown): value is HyperliquidCandle {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<HyperliquidCandle>;
  return (
    typeof candidate.t === "number" &&
    typeof candidate.T === "number" &&
    typeof candidate.o === "string" &&
    typeof candidate.h === "string" &&
    typeof candidate.l === "string" &&
    typeof candidate.c === "string" &&
    typeof candidate.v === "string" &&
    typeof candidate.n === "number"
  );
}
