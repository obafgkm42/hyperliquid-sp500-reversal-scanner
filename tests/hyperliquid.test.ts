import { describe, expect, it } from "vitest";

import {
  fetchFiveMinuteCandles,
  HyperliquidRateLimitError,
} from "../src/hyperliquid";

describe("fetchFiveMinuteCandles", () => {
  it("retries transient rate limits before returning candles", async () => {
    const responses = [
      new Response("rate limited", { status: 429 }),
      new Response("rate limited", { status: 429 }),
      Response.json([
        {
          t: 1_788_000_000_000,
          T: 1_788_000_299_999,
          o: "100",
          h: "101",
          l: "99",
          c: "100.5",
          v: "42",
          n: 7,
        },
      ]),
    ];
    const fetcher = async (): Promise<Response> => {
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("unexpected extra fetch");
      }
      return response;
    };

    const candles = await fetchFiveMinuteCandles(
      "xyz:SP500",
      new Date("2026-09-02T00:10:00Z"),
      fetcher as typeof fetch,
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(100.5);
    expect(responses).toHaveLength(0);
  });

  it("throws a typed error after repeated rate limits", async () => {
    const fetcher = async (): Promise<Response> =>
      new Response("rate limited", { status: 429 });

    await expect(
      fetchFiveMinuteCandles(
        "xyz:SP500",
        new Date("2026-09-02T00:10:00Z"),
        fetcher as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(HyperliquidRateLimitError);
  });
});
