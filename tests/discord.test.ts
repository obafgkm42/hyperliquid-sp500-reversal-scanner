import { describe, expect, it } from "vitest";

import { sendMarketBrief, sendSignal, sendVersionNotice } from "../src/discord";
import type { ReversalLocation, ScanResult } from "../src/types";

describe("sendMarketBrief", () => {
  it("sends a Discord heartbeat when no signal is present", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };
    const result: ScanResult = {
      market: "xyz:SP500",
      candleCount: 12,
      sessionHigh: 6100,
      sessionLow: 6075,
      latestPrice: 6090,
      status: "no fresh lookback extreme rejection passed price-R and confidence thresholds",
      watch: null,
      signal: null,
    };

    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T00:30:00Z"),
      fetcher as typeof fetch,
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.content).toContain("SP500 半小時簡報");
    expect(payload.content).not.toContain("😌");
    expect(payload.content).toContain("最新 6090.0");
    expect(payload.content).toContain("日內 6075.0–6100.0");
    expect(payload.content).toContain("暫無合格訊號");
    expect(payload.embeds[0].title).toContain("半小時簡報");
    expect(payload.embeds[0].description).toContain("xyz:SP500 最新 6090.0");
    expect(payload.embeds[0].description).toContain("日內區間 6075.0–6100.0");
    expect(payload.embeds[0].description).toContain("暫無合格訊號");
    expect(payload.embeds[0].description).toContain(result.status);
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "最新價格", value: "6090.0" }),
      ]),
    );
  });

  it("attaches a chart image when one is available", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };
    const result: ScanResult = {
      market: "xyz:SP500",
      candleCount: 12,
      sessionHigh: 6100,
      sessionLow: 6075,
      latestPrice: 6090,
      status: "no fresh lookback extreme rejection passed price-R and confidence thresholds",
      watch: null,
      signal: null,
    };

    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T00:30:00Z"),
      fetcher as typeof fetch,
      {
        filename: "SP500-brief-chart.png",
        contentType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
    );

    const body = requests[0]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    const payload = JSON.parse(String(form.get("payload_json")));
    expect(payload.content).toContain("最新 6090.0");
    expect(payload.content).toContain("暫無合格訊號");
    expect(payload.attachments[0].filename).toBe("SP500-brief-chart.png");
    expect(payload.embeds[0].image.url).toBe(
      "attachment://SP500-brief-chart.png",
    );
    expect(form.get("files[0]")).toBeInstanceOf(File);
  });
});

describe("sendSignal", () => {
  it("labels watch-level opportunities separately from alerts", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };

    await sendSignal(
      "https://discord.com/api/webhooks/example/token",
      opportunity("watch"),
      fetcher as typeof fetch,
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.embeds[0].title).toContain("WATCH");
    expect(payload.embeds[0].description).toContain("提早觀察級別");
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "級別", value: "WATCH" }),
      ]),
    );
  });
});

describe("sendVersionNotice", () => {
  it("sends the active worker version", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };

    await sendVersionNotice(
      "https://discord.com/api/webhooks/example/token",
      "2.1.0",
      new Date("2026-06-24T00:00:00Z"),
      fetcher as typeof fetch,
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.embeds[0].description).toContain("2.1.0");
    expect(payload.embeds[0].description).toContain("2026-06-24T00:00:00.000Z");
  });
});

function opportunity(level: "watch" | "alert"): ReversalLocation {
  return {
    level,
    direction: "bullish",
    market: "xyz:SP500",
    price: 6090,
    entryLow: 6088,
    entryHigh: 6092,
    invalidation: 6078,
    target: 6125,
    sessionHigh: 6130,
    sessionLow: 6075,
    vwap: 6110,
    priceRiskReward: 2.8,
    confidenceScore: 66,
    policy: {
      name: "modern_reversal_zone_v1",
      role: "bullish_reversal_zone",
      watchEligible: true,
      alertEligible: true,
      reasons: ["modern reversal-zone regime gate passed"],
    },
    reasons: ["fresh lookback low rejected"],
    timestamp: Date.parse("2026-06-24T00:30:00Z"),
  };
}
