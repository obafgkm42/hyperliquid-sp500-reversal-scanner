import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/types";

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";

describe("scheduled catch-up scan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("catches a signal between boundaries with one candle request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        calls.push({ url, init });
        if (url === HYPERLIQUID_INFO_URL) {
          return Response.json(hyperliquidCandles());
        }
        return new Response(null, { status: 204 });
      },
    );
    const waitUntilPromises: Promise<unknown>[] = [];

    await worker.scheduled(
      scheduledController("2026-07-23T15:45:00.000Z"),
      baseEnv(),
      waitUntilContext(waitUntilPromises),
    );
    await Promise.all(waitUntilPromises);

    const candleRequests = calls.filter(
      (call) => call.url === HYPERLIQUID_INFO_URL,
    );
    const webhookRequests = calls.filter(
      (call) => call.url !== HYPERLIQUID_INFO_URL,
    );
    expect(candleRequests).toHaveLength(1);
    expect(webhookRequests).toHaveLength(1);

    const payload = JSON.parse(
      String(webhookRequests[0]?.init?.body),
    ) as {
      embeds: Array<{ timestamp: string }>;
    };
    expect(payload.embeds[0]?.timestamp).toBe(
      "2026-07-23T15:34:59.999Z",
    );
  });

  it("sends a due brief even when the signal cadence gate is closed", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        calls.push({ url, init });
        if (url === HYPERLIQUID_INFO_URL) {
          const body = JSON.parse(String(init?.body)) as { type: string };
          if (body.type === "metaAndAssetCtxs") {
            return new Response("context unavailable", { status: 400 });
          }
          return Response.json(hyperliquidCandles());
        }
        return new Response(null, { status: 204 });
      },
    );
    const waitUntilPromises: Promise<unknown>[] = [];

    await worker.scheduled(
      scheduledController("2026-07-23T15:30:00.000Z"),
      {
        ...baseEnv(),
        REGULAR_SCAN_MINUTES: "20",
        BRIEF_INTERVAL_MINUTES: "30",
      },
      waitUntilContext(waitUntilPromises),
    );
    await Promise.all(waitUntilPromises);

    const candleRequests = calls.filter(
      (call) => call.url === HYPERLIQUID_INFO_URL,
    );
    const webhookRequests = calls.filter(
      (call) => call.url !== HYPERLIQUID_INFO_URL,
    );
    expect(candleRequests).toHaveLength(2);
    expect(webhookRequests).toHaveLength(1);

    const body = webhookRequests[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    const payload = JSON.parse(
      String((body as FormData).get("payload_json")),
    ) as {
      embeds: Array<{ title: string }>;
    };
    expect(payload.embeds[0]?.title).toContain("市場狀態");
    expect(payload.embeds[0]?.title).toContain("BREAKING");
  });

  it("recovers from the last successful candle after a rate-limited scan", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const state = memoryKv({
      "last-version-notice": "local-dev",
      "last-successful-candle:xyz:SP500": String(
        Date.parse("2026-07-23T15:29:59.999Z"),
      ),
    });
    let candleAttempts = 0;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        calls.push({ url, init });
        if (url === HYPERLIQUID_INFO_URL) {
          candleAttempts += 1;
          if (candleAttempts <= 3) {
            return new Response(null, { status: 429 });
          }
          return Response.json(hyperliquidCandles());
        }
        return new Response(null, { status: 204 });
      },
    );

    const failedPromises: Promise<unknown>[] = [];
    await worker.scheduled(
      scheduledController("2026-07-23T15:45:00.000Z"),
      {
        ...baseEnv(),
        BRIEF_INTERVAL_MINUTES: "17",
        SCANNER_STATE: state,
      },
      waitUntilContext(failedPromises),
    );
    await Promise.all(failedPromises);

    const recoveredPromises: Promise<unknown>[] = [];
    await worker.scheduled(
      scheduledController("2026-07-23T16:00:00.000Z"),
      {
        ...baseEnv(),
        BRIEF_INTERVAL_MINUTES: "17",
        SCANNER_STATE: state,
      },
      waitUntilContext(recoveredPromises),
    );
    await Promise.all(recoveredPromises);

    const webhookRequests = calls.filter(
      (call) => call.url !== HYPERLIQUID_INFO_URL,
    );
    expect(webhookRequests).toHaveLength(1);
    expect(
      await state.get("last-successful-candle:xyz:SP500"),
    ).toBe(String(Date.parse("2026-07-23T15:44:59.999Z")));
  });
});

function baseEnv(): Env {
  return {
    DISCORD_WEBHOOK_URL:
      "https://discord.com/api/webhooks/example/token",
    MINIMUM_WATCH_PRICE_R: "1",
    MINIMUM_WATCH_CONFIDENCE_SCORE: "60",
    MINIMUM_PRICE_R: "1",
    MINIMUM_CONFIDENCE_SCORE: "60",
  };
}

function hyperliquidCandles(): Array<Record<string, number | string>> {
  const firstStartTime = Date.parse("2026-07-23T14:45:00.000Z");
  const values = [
    [100, 102, 99, 101, 100],
    [101, 103, 100, 102, 100],
    [102, 104, 101, 103, 100],
    [103, 104, 100, 101, 100],
    [101, 102, 98, 99, 100],
    [99, 100, 97, 98, 100],
    [98, 99, 96, 97, 100],
    [97, 98, 95, 96, 100],
    [96, 97, 94, 95, 100],
    [91.5, 93.8, 91, 93.5, 220],
    [93.5, 94, 92.5, 93.7, 100],
    [93.7, 94.5, 93, 94, 100],
  ];

  return values.map(
    ([open, high, low, close, volume], index) => {
      const startTime = firstStartTime + index * 300_000;
      return {
        t: startTime,
        T: startTime + 299_999,
        o: String(open),
        h: String(high),
        l: String(low),
        c: String(close),
        v: String(volume),
        n: 10,
      };
    },
  );
}

function scheduledController(timestamp: string): ScheduledController {
  return {
    scheduledTime: new Date(timestamp).getTime(),
    cron: "*/5 * * * *",
    noRetry: vi.fn(),
  };
}

function waitUntilContext(
  promises: Promise<unknown>[],
): ExecutionContext {
  return {
    waitUntil: (promise: Promise<unknown>) => {
      promises.push(promise);
    },
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

function memoryKv(initial: Record<string, string>): KVNamespace {
  const values = new Map(Object.entries(initial));
  return {
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
}
