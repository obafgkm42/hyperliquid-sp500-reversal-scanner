import { describe, expect, it } from "vitest";

import { formatMarketActivitySummary } from "../src/market-activity-format";
import type { MarketActivitySnapshot } from "../src/types";

describe("formatMarketActivitySummary", () => {
  it("renders factor, percentile, burst, confidence, and New York as-of time", () => {
    expect(
      formatMarketActivitySummary(activitySnapshot(), "zh"),
    ).toBe(
      "ACTIVE · 累積 RVOL 1.31x · P82/46 · 15m 1.70x ELEVATED · 可信度 確認 · 截至 11:30 ET",
    );
  });

  it("explains an insufficient snapshot without inventing an RVOL value", () => {
    expect(
      formatMarketActivitySummary(
        {
          ...activitySnapshot(),
          level: "UNKNOWN",
          sessionRvol: null,
          barRvol: null,
          barActivity: null,
          percentile: null,
          percentileBand: null,
          sampleSessions: 3,
          confidence: "unavailable",
          dataQuality: "insufficient",
        },
        "en",
      ),
    ).toContain("UNKNOWN · activity data unavailable · 3 historical sessions");
  });
});

function activitySnapshot(): MarketActivitySnapshot {
  return {
    market: "xyz:SP500",
    sessionKey: "2026-06-23",
    level: "ACTIVE",
    sessionRvol: 1.31,
    barRvol: 1.7,
    barActivity: "elevated",
    percentile: 82,
    percentileBand: "high",
    sampleSessions: 46,
    confidence: "confirmed",
    dataQuality: "good",
    currentSlotIndex: 7,
    asOf: Date.parse("2026-06-23T15:30:00.000Z"),
    source: "hyperliquid",
  };
}
