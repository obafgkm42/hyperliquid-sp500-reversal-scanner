import { describe, expect, it } from "vitest";

import {
  getLastSuccessfulCandleEnd,
  markSignalSent,
  setLastSuccessfulCandleEnd,
  wasSignalSent,
} from "../src/scanner-state";
import type { ReversalLocation } from "../src/types";

describe("scanner state", () => {
  it("persists the last successfully covered candle", async () => {
    const state = memoryKv();

    expect(
      await getLastSuccessfulCandleEnd(state, "xyz:SP500"),
    ).toBeNull();
    await setLastSuccessfulCandleEnd(
      state,
      "xyz:SP500",
      1_700_000_000_000,
    );

    expect(
      await getLastSuccessfulCandleEnd(state, "xyz:SP500"),
    ).toBe(1_700_000_000_000);
  });

  it("deduplicates an exact signal after it is sent", async () => {
    const state = memoryKv();
    const signal = opportunity();

    expect(await wasSignalSent(state, signal)).toBe(false);
    await markSignalSent(state, signal);
    expect(await wasSignalSent(state, signal)).toBe(true);
  });
});

function memoryKv(): KVNamespace {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
}

function opportunity(): ReversalLocation {
  return {
    level: "alert",
    direction: "bullish",
    market: "xyz:SP500",
    price: 100,
    entryLow: 99,
    entryHigh: 101,
    invalidation: 95,
    target: 110,
    sessionHigh: 110,
    sessionLow: 95,
    vwap: 105,
    priceRiskReward: 2,
    confidenceScore: 80,
    policy: {
      name: "modern_reversal_zone_v1",
      role: "bullish_reversal_zone",
      alertEligible: true,
      watchEligible: true,
      reasons: [],
    },
    reasons: [],
    timestamp: 1_700_000_000_000,
  };
}
