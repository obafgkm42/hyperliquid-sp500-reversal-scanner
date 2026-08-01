import type { ReversalLocation } from "./types";

const LAST_SUCCESSFUL_CANDLE_PREFIX = "last-successful-candle";
const SENT_SIGNAL_PREFIX = "sent-signal";
const SENT_SIGNAL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Read the latest completed candle covered by a successful notification scan.
 */
export async function getLastSuccessfulCandleEnd(
  state: KVNamespace | undefined,
  market: string,
): Promise<number | null> {
  if (state === undefined) {
    return null;
  }
  const rawValue = await state.get(lastSuccessfulCandleKey(market));
  if (rawValue === null) {
    return null;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

/**
 * Persist the latest completed candle only after a scan finishes successfully.
 */
export async function setLastSuccessfulCandleEnd(
  state: KVNamespace | undefined,
  market: string,
  candleEndTime: number,
): Promise<void> {
  if (state === undefined) {
    return;
  }
  await state.put(
    lastSuccessfulCandleKey(market),
    String(candleEndTime),
  );
}

/**
 * Return whether this exact market, level, direction, and candle was sent.
 */
export async function wasSignalSent(
  state: KVNamespace | undefined,
  signal: ReversalLocation,
): Promise<boolean> {
  if (state === undefined) {
    return false;
  }
  return (await state.get(sentSignalKey(signal))) !== null;
}

/**
 * Mark an alert after Discord accepts it so retries do not resend it.
 */
export async function markSignalSent(
  state: KVNamespace | undefined,
  signal: ReversalLocation,
): Promise<void> {
  if (state === undefined) {
    return;
  }
  await state.put(sentSignalKey(signal), "1", {
    expirationTtl: SENT_SIGNAL_TTL_SECONDS,
  });
}

function lastSuccessfulCandleKey(market: string): string {
  return `${LAST_SUCCESSFUL_CANDLE_PREFIX}:${market}`;
}

function sentSignalKey(signal: ReversalLocation): string {
  return [
    SENT_SIGNAL_PREFIX,
    signal.market,
    signal.level,
    signal.direction,
    signal.timestamp,
  ].join(":");
}
