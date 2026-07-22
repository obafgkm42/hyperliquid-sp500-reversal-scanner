import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/types";

describe("scheduled version notices", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send a version notice without version metadata or KV state", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const waitUntilPromises: Promise<unknown>[] = [];

    await worker.scheduled(
      scheduledController("2026-06-24T12:46:37.000Z"),
      baseEnv(),
      waitUntilContext(waitUntilPromises),
    );
    await Promise.all(waitUntilPromises);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not send stale no-KV version notices after the deploy window", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const waitUntilPromises: Promise<unknown>[] = [];

    await worker.scheduled(
      scheduledController("2026-06-24T13:31:00.000Z"),
      {
        ...baseEnv(),
        CF_VERSION_METADATA: {
          id: "1234567890abcdef",
          tag: "latest",
          timestamp: "2026-06-24T12:45:00.000Z",
        },
      },
      waitUntilContext(waitUntilPromises),
    );
    await Promise.all(waitUntilPromises);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends a recent no-KV version notice as a best-effort deploy signal", async () => {
    const requests: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push(init ?? {});
        return new Response(null, { status: 204 });
      },
    );
    const waitUntilPromises: Promise<unknown>[] = [];

    await worker.scheduled(
      scheduledController("2026-06-24T12:46:37.000Z"),
      {
        ...baseEnv(),
        CF_VERSION_METADATA: {
          id: "1234567890abcdef",
          tag: "latest",
          timestamp: "2026-06-24T12:45:00.000Z",
        },
      },
      waitUntilContext(waitUntilPromises),
    );
    await Promise.all(waitUntilPromises);

    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.body)).toContain("2026.06.24.204500");
  });

  it("sends one version notice when the Cloudflare version changes", async () => {
    const requests: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push(init ?? {});
        return new Response(null, { status: 204 });
      },
    );
    const writes: Array<[string, string]> = [];
    const waitUntilPromises: Promise<unknown>[] = [];

    await worker.scheduled(
      scheduledController("2026-06-24T12:46:37.000Z"),
      {
        ...baseEnv(),
        CF_VERSION_METADATA: {
          id: "1234567890abcdef",
          tag: "latest",
          timestamp: "2026-06-24T12:45:00.000Z",
        },
        SCANNER_STATE: {
          get: async () => null,
          put: async (key: string, value: string) => {
            writes.push([key, value]);
          },
        } as unknown as KVNamespace,
      },
      waitUntilContext(waitUntilPromises),
    );
    await Promise.all(waitUntilPromises);

    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.body)).toContain("2026.06.24.204500");
    expect(writes).toEqual([["last-version-notice", "cf-1234567890ab"]]);
  });

  it("passes the configured language to version notifications", async () => {
    const requests: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push(init ?? {});
        return new Response(null, { status: 204 });
      },
    );
    const waitUntilPromises: Promise<unknown>[] = [];

    await worker.scheduled(
      scheduledController("2026-06-24T12:46:37.000Z"),
      {
        ...baseEnv(),
        LANGUAGE: "en",
        CF_VERSION_METADATA: {
          id: "abcdef1234567890",
          tag: "latest",
          timestamp: "2026-06-24T12:45:00.000Z",
        },
        SCANNER_STATE: {
          get: async () => null,
          put: async () => undefined,
        } as unknown as KVNamespace,
      },
      waitUntilContext(waitUntilPromises),
    );
    await Promise.all(waitUntilPromises);

    const payload = JSON.parse(String(requests[0]?.body));
    expect(payload.embeds[0].title).toBe(
      "Hyperliquid SP500 Reversal Scanner updated",
    );
    expect(payload.embeds[0].fields[0].name).toBe("Reminder");
  });
});

function baseEnv(): Env {
  return {
    DISCORD_WEBHOOK_URL:
      "https://discord.com/api/webhooks/example/token",
  };
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
