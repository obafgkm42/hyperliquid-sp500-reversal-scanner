import { describe, expect, it } from "vitest";

import {
  publicScanResult,
  sendMarketBrief,
  sendRateLimitNotice,
  sendSignal,
  sendVersionNotice,
} from "../src/discord";
import type {
  MarketFragilitySnapshot,
  ReversalLocation,
  ScanResult,
} from "../src/types";

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
    expect(payload.embeds[0].description).toContain(
      "沒有新的回看極值拒絕形態",
    );
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "最新價格", value: "6090.0" }),
      ]),
    );
  });

  it("renders an English brief when configured", async () => {
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
      status: "no fresh lookback extreme rejection passed watch or alert thresholds",
      watch: null,
      signal: null,
    };

    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T00:30:00Z"),
      fetcher as typeof fetch,
      undefined,
      "en",
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.content).toContain("SP500 30-minute brief");
    expect(payload.content).toContain("No qualified signal");
    expect(payload.embeds[0].title).toBe(
      "SP500 Reversal Scanner 30-Minute Brief",
    );
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Latest price", value: "6090.0" }),
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

  it("puts the market fragility state in the push preview and embed", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };
    const result: ScanResult = {
      market: "xyz:SP500",
      candleCount: 12,
      sessionHigh: 6100,
      sessionLow: 6000,
      latestPrice: 6010,
      status: "no fresh lookback extreme rejection passed watch or alert thresholds",
      watch: null,
      signal: null,
    };

    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T00:30:00Z"),
      fetcher as typeof fetch,
      undefined,
      "zh",
      fragilitySnapshot(),
    );
    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T00:30:00Z"),
      fetcher as typeof fetch,
      undefined,
      "en",
      fragilitySnapshot(),
    );

    const payload = JSON.parse(String(requests[0]?.body));
    const englishPayload = JSON.parse(String(requests[1]?.body));
    expect(payload.content).toMatch(/^@everyone /);
    expect(payload.content).toContain("市場狀態 BREAKING · 壓力 60/100");
    expect(payload.content).toContain("3/6 修復機制受壓");
    expect(payload.allowed_mentions).toEqual({ parse: ["everyone"] });
    expect(payload.embeds[0].title).toBe("SP500 市場狀態 · BREAKING");
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "受壓修復機制",
          value: expect.stringContaining("VWAP 修復失敗"),
        }),
        expect.objectContaining({
          name: "資料覆蓋",
          value: "6/6 · 完整",
        }),
      ]),
    );
    expect(englishPayload.content).toContain(
      "BREAKING · stress 60/100 · 3/6 repair mechanisms stressed",
    );
  });

  it("labels a resilient zero score as zero stress", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };
    const result: ScanResult = {
      market: "xyz:SP500",
      candleCount: 12,
      sessionHigh: 6100,
      sessionLow: 6000,
      latestPrice: 6090,
      status: "no fresh lookback extreme rejection passed watch or alert thresholds",
      watch: null,
      signal: null,
    };
    const resilientSnapshot = {
      ...fragilitySnapshot(),
      level: "resilient" as const,
      score: 0,
      stressedIndicatorCount: 0,
    };

    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T00:30:00Z"),
      fetcher as typeof fetch,
      undefined,
      "zh",
      resilientSnapshot,
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.content).toContain(
      "市場狀態 RESILIENT · 壓力 0/100 · 0/6 修復機制受壓",
    );
    expect(payload.embeds[0].description).toContain(
      "RESILIENT · 壓力 0/100 · 0/6 個修復機制受壓",
    );
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "市場韌性",
          value: "RESILIENT · 壓力 0/100 · 0/6 個修復機制受壓",
        }),
      ]),
    );
  });

  it("broadcasts panic but does not mention everyone below breaking", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };
    const result: ScanResult = {
      market: "xyz:SP500",
      candleCount: 12,
      sessionHigh: 6100,
      sessionLow: 6000,
      latestPrice: 6010,
      status: "no fresh lookback extreme rejection passed watch or alert thresholds",
      watch: null,
      signal: null,
    };

    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T01:00:00Z"),
      fetcher as typeof fetch,
      undefined,
      "zh",
      { ...fragilitySnapshot(), level: "panic", score: 80 },
    );
    await sendMarketBrief(
      "https://discord.com/api/webhooks/example/token",
      result,
      new Date("2026-06-24T01:30:00Z"),
      fetcher as typeof fetch,
      undefined,
      "zh",
      {
        ...fragilitySnapshot(),
        level: "fragile",
        score: 35,
        stressedIndicatorCount: 2,
      },
    );

    const panic = JSON.parse(String(requests[0]?.body));
    const fragile = JSON.parse(String(requests[1]?.body));
    expect(panic.content).toMatch(/^@everyone /);
    expect(panic.allowed_mentions).toEqual({ parse: ["everyone"] });
    expect(fragile.content).not.toContain("@everyone");
    expect(fragile.allowed_mentions).toEqual({ parse: [] });
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

  it("renders English signal copy and diagnostics when configured", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };

    await sendSignal(
      "https://discord.com/api/webhooks/example/token",
      opportunity("watch"),
      fetcher as typeof fetch,
      "en",
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.embeds[0].title).toContain(
      "Bottom reversal candidate zone",
    );
    expect(payload.embeds[0].description).toContain("Early WATCH level");
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Level", value: "WATCH" }),
        expect.objectContaining({
          name: "Why it qualifies",
          value: "• fresh lookback low rejected",
        }),
      ]),
    );
  });

  it("shows arrival time and price separately from the signal price", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };

    await sendSignal(
      "https://discord.com/api/webhooks/example/token",
      opportunity("alert"),
      fetcher as typeof fetch,
      "en",
      {
        observedAt: Date.parse("2026-06-24T00:45:00Z"),
        observedPrice: 6091.5,
      },
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Delivered / current price",
          value: "2026-06-24T00:45:00.000Z / 6091.5",
        }),
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

  it("renders an English version notice when configured", async () => {
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
      "en",
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.embeds[0].title).toContain("updated");
    expect(payload.embeds[0].description).toContain(
      "Worker version `2.1.0` is active.",
    );
    expect(payload.embeds[0].fields[0].name).toBe("Reminder");
  });
});

describe("sendRateLimitNotice", () => {
  it("makes a skipped scan visible without claiming that no setup existed", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };

    await sendRateLimitNotice(
      "https://discord.com/api/webhooks/example/token",
      "xyz:SP500",
      new Date("2026-08-01T13:00:23Z"),
      fetcher as typeof fetch,
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.content).toContain("掃描未完成");
    expect(payload.content).toContain("下一個排程會自動重試");
    expect(payload.embeds[0].title).toContain("資料源限流");
    expect(payload.embeds[0].description).toContain(
      "這不代表當時沒有交易候選區",
    );
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("renders the degradation notice in English when configured", async () => {
    const requests: RequestInit[] = [];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(null, { status: 204 });
    };

    await sendRateLimitNotice(
      "https://discord.com/api/webhooks/example/token",
      "xyz:SP500",
      new Date("2026-08-01T13:00:23Z"),
      fetcher as typeof fetch,
      "en",
    );

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.content).toContain("scan incomplete");
    expect(payload.embeds[0].description).toContain(
      "This does not mean that no setup existed",
    );
  });
});

describe("publicScanResult", () => {
  it("localizes status text without changing machine-readable enums", () => {
    const result: ScanResult = {
      market: "xyz:SP500",
      candleCount: 12,
      sessionHigh: 6100,
      sessionLow: 6075,
      latestPrice: 6090,
      status: "watch-level modern reversal-zone setup found; alert thresholds not yet met",
      watch: opportunity("watch"),
      signal: null,
    };

    const localized = publicScanResult(
      result,
      "zh",
      fragilitySnapshot(),
    ) as {
      status: string;
      watch: { direction: string; policy: { reasons: string[] } };
      marketFragility: MarketFragilitySnapshot;
    };

    expect(localized.status).toContain("WATCH 級別");
    expect(localized.watch.direction).toBe("bullish");
    expect(localized.watch.policy.reasons[0]).toBe(
      "已通過現代反轉區市場狀態門檻",
    );
    expect(localized.marketFragility.level).toBe("breaking");
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

function fragilitySnapshot(): MarketFragilitySnapshot {
  return {
    level: "breaking",
    score: 60,
    stressedIndicatorCount: 3,
    availableIndicatorCount: 6,
    totalIndicatorCount: 6,
    dataQuality: "full",
    indicators: [
      {
        id: "session_loss",
        state: "stressed",
        value: -0.012,
        displayValue: "-1.20%",
        threshold: "<= -1.0%",
      },
      {
        id: "vwap_repair_failure",
        state: "stressed",
        value: -0.5,
        displayValue: "-0.50 ATR",
        threshold: "<= -0.35 ATR and 3 closes below VWAP",
      },
      {
        id: "poor_close_location",
        state: "stressed",
        value: 0.1,
        displayValue: "10%",
        threshold: "<= 25% of range",
      },
      {
        id: "downside_tail_cluster",
        state: "healthy",
        value: 1,
        displayValue: "1/11 <= -0.25%",
        threshold: ">= 2 volatility-adjusted large down returns",
      },
      {
        id: "mega_cap_breadth",
        state: "healthy",
        value: 0.3,
        displayValue: "30% (7 assets)",
        threshold: ">= 70% down at least 0.5%",
      },
      {
        id: "equity_cross_confirmation",
        state: "healthy",
        value: -0.004,
        displayValue: "SP500 -0.40% / XYZ100 -0.40%",
        threshold: "SP500 and XYZ100 both <= -0.75%",
      },
    ],
  };
}
