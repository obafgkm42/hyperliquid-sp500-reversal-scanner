import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("loads the default cadence", () => {
    const config = loadConfig({
      DISCORD_WEBHOOK_URL:
        "https://discord.com/api/webhooks/example/token",
    });

    expect(config.hyperliquidCoin).toBe("xyz:SP500");
    expect(config.regularScanMinutes).toBe(15);
    expect(config.finalHourScanMinutes).toBe(5);
    expect(config.briefIntervalMinutes).toBe(30);
    expect(config.minimumWatchPriceR).toBe(2);
    expect(config.minimumWatchConfidenceScore).toBe(64);
    expect(config.minimumPriceR).toBe(3.5);
    expect(config.minimumConfidenceScore).toBe(72);
    expect(config.workerVersionKey).toBe("local-dev");
    expect(config.workerVersionLabel).toBe("local-dev");
    expect(config.workerVersionUploadedAt).toBeNull();
  });

  it("uses Cloudflare metadata for the deploy key and readable version label", () => {
    const config = loadConfig({
      DISCORD_WEBHOOK_URL:
        "https://discord.com/api/webhooks/example/token",
      WORKER_VERSION: "manual-local-version",
      CF_VERSION_METADATA: {
        id: "1234567890abcdef",
        tag: "latest",
        timestamp: "2026-06-24T12:00:00.000Z",
      },
    });

    expect(config.workerVersionKey).toBe("cf-1234567890ab");
    expect(config.workerVersionLabel).toBe("2026.06.24.200000");
    expect(config.workerVersionUploadedAt?.toISOString()).toBe(
      "2026-06-24T12:00:00.000Z",
    );
  });

  it("rejects a missing Discord secret", () => {
    expect(() => loadConfig({ DISCORD_WEBHOOK_URL: "" })).toThrow(
      "DISCORD_WEBHOOK_URL",
    );
  });
});
