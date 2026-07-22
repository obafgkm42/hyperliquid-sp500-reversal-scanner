import { describe, expect, it } from "vitest";

import {
  filterCurrentSession,
  getBriefIntervalMinutes,
  getScheduleDecision,
} from "../src/market-hours";
import type { Candle } from "../src/types";

const cadence = {
  regularScanMinutes: 15,
  finalHourScanMinutes: 5,
};

describe("getScheduleDecision", () => {
  it("runs every fifteen minutes outside the New York final hour", () => {
    expect(
      getScheduleDecision(
        new Date("2026-06-23T18:45:00Z"),
        cadence,
      ).shouldRun,
    ).toBe(true);
    expect(
      getScheduleDecision(
        new Date("2026-06-23T18:50:00Z"),
        cadence,
      ).shouldRun,
    ).toBe(false);
  });

  it("runs every five minutes during the New York final hour", () => {
    const decision = getScheduleDecision(
      new Date("2026-06-23T19:10:00Z"),
      cadence,
    );

    expect(decision.shouldRun).toBe(true);
    expect(decision.intervalMinutes).toBe(5);
  });

  it("does not skip overnight or weekend Hyperliquid scans", () => {
    expect(
      getScheduleDecision(
        new Date("2026-06-24T04:30:00Z"),
        cadence,
      ).shouldRun,
    ).toBe(true);
    expect(
      getScheduleDecision(
        new Date("2026-06-27T15:30:00Z"),
        cadence,
      ).shouldRun,
    ).toBe(true);
  });

  it("handles winter daylight saving offsets at runtime", () => {
    const decision = getScheduleDecision(
      new Date("2026-12-15T20:10:00Z"),
      cadence,
    );

    expect(decision.shouldRun).toBe(true);
    expect(decision.intervalMinutes).toBe(5);
  });
});

describe("getBriefIntervalMinutes", () => {
  it("keeps the configured brief interval on New York weekdays", () => {
    expect(
      getBriefIntervalMinutes(
        new Date("2026-06-24T00:30:00Z"),
        30,
      ),
    ).toBe(30);
  });

  it("lowers weekend brief frequency to once per hour", () => {
    expect(
      getBriefIntervalMinutes(
        new Date("2026-06-27T15:30:00Z"),
        30,
      ),
    ).toBe(60);
  });

  it("does not shorten an already slower weekend brief interval", () => {
    expect(
      getBriefIntervalMinutes(
        new Date("2026-06-27T15:30:00Z"),
        120,
      ),
    ).toBe(120);
  });
});

describe("filterCurrentSession", () => {
  it("keeps all candles from the current New York date", () => {
    const candles: Candle[] = [
      candleAt("2026-06-23T05:00:00Z"),
      candleAt("2026-06-23T13:30:00Z"),
      candleAt("2026-06-23T19:55:00Z"),
      candleAt("2026-06-24T04:00:00Z"),
    ];

    expect(
      filterCurrentSession(
        candles,
        new Date("2026-06-23T19:59:00Z"),
      ),
    ).toHaveLength(3);
  });

  it("falls back to the fetched lookback when the current date has no candles", () => {
    const candles: Candle[] = [
      candleAt("2026-06-22T13:30:00Z"),
      candleAt("2026-06-22T13:35:00Z"),
    ];

    expect(
      filterCurrentSession(
        candles,
        new Date("2026-06-23T01:00:00Z"),
      ),
    ).toHaveLength(2);
  });

  it("keeps the correct New York date across the winter UTC offset", () => {
    const candles: Candle[] = [
      candleAt("2026-12-15T04:55:00Z"),
      candleAt("2026-12-15T05:00:00Z"),
    ];

    expect(
      filterCurrentSession(
        candles,
        new Date("2026-12-15T05:05:00Z"),
      ).map((candle) => candle.startTime),
    ).toEqual([candles[1]?.startTime]);
  });
});

function candleAt(timestamp: string): Candle {
  const startTime = new Date(timestamp).getTime();
  return {
    startTime,
    endTime: startTime + 299_999,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    tradeCount: 1,
  };
}
