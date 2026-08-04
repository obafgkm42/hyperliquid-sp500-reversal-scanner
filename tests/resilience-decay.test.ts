import { describe, expect, it } from "vitest";

import {
  calculateResilienceEventScore,
  calculateResilienceMetrics,
  updateResilienceDecayState,
} from "../src/resilience-decay";
import type {
  ResilienceDecayState,
  ResiliencePriceSnapshot,
  ResilienceShockEvent,
} from "../src/types";

describe("resilience decay state", () => {
  it("logs a shock, trough, and raw one-hour, two-hour, and close observations", async () => {
    const state = countingMemoryKv();
    const sessionKey = "2026-08-04";

    await record(state, snapshot(sessionKey, 0, 100, 100));
    const started = await record(state, snapshot(sessionKey, 30, 99.4, 100));
    expect(started.shockStarted).toBe(true);
    await record(state, snapshot(sessionKey, 60, 98.8, 100));
    await record(state, snapshot(sessionKey, 90, 99.5, 100));
    await record(state, snapshot(sessionKey, 150, 99.7, 100));
    const closed = await record(
      state,
      snapshot(sessionKey, 390, 100, 100, true),
    );

    const event = closed.state?.completedShocks.at(-1);
    expect(event).toMatchObject({
      triggerPrice: 99.4,
      troughPrice: 98.8,
      oneHourPrice: 99.5,
      twoHourPrice: 99.7,
      closePrice: 100,
      completionReason: "recovered",
    });
    expect(closed.state?.activeShock).toBeNull();
  });

  it("keeps only the current session snapshots and the latest twelve shocks", async () => {
    const state = countingMemoryKv();

    for (let day = 0; day < 13; day += 1) {
      const sessionKey = `2026-08-${String(day + 1).padStart(2, "0")}`;
      await record(state, snapshot(sessionKey, 0, 100, 100));
      await record(state, snapshot(sessionKey, 30, 99, 100));
      await record(
        state,
        snapshot(sessionKey, 60, 100, 100, true),
      );
    }

    const saved = await readState(state);
    expect(saved.snapshots).toHaveLength(3);
    expect(
      saved.snapshots.every((item) => item.sessionKey === "2026-08-13"),
    ).toBe(true);
    expect(saved.sessionKey).toBe("2026-08-13");
    expect(saved.completedShocks).toHaveLength(12);
    expect(saved.completedShocks[0]?.sessionKey).toBe("2026-08-02");
  });

  it("skips the write when a snapshot was already recorded", async () => {
    const state = countingMemoryKv();
    const priceSnapshot = snapshot("2026-08-04", 0, 100, 100);

    await updateResilienceDecayState(
      state,
      "xyz:SP500",
      priceSnapshot,
    );
    const repeated = await updateResilienceDecayState(
      state,
      "xyz:SP500",
      priceSnapshot,
    );

    expect(repeated.changed).toBe(false);
    expect(state.getCount).toBe(2);
    expect(state.putCount).toBe(1);
    expect(repeated.approximateCpuMs).toBeGreaterThanOrEqual(0);
  });

  it("applies the weighted event score to the three recovery ratios", () => {
    const score = calculateResilienceEventScore(
      completedEvent("weighted", 100, 90, 100, 90, 95),
    );

    expect(score).toMatchObject({
      oneHourRecoveryRatio: 1,
      twoHourRecoveryRatio: 0,
      closeRecoveryRatio: 0.5,
      eventScore: 45,
    });
  });

  it("calculates recent, baseline, slope, and bounded decay metrics", () => {
    const eventScores = [80, 78, 75, 72, 70, 60, 55, 50];
    const metrics = calculateResilienceMetrics({
      version: 1,
      market: "xyz:SP500",
      sessionKey: "2026-08-04",
      snapshots: [],
      activeShock: null,
      completedShocks: eventScores.map((score, index) =>
        completedEvent(
          `event-${index}`,
          100,
          90,
          90 + score / 10,
          90 + score / 10,
          90 + score / 10,
        ),
      ),
    });

    expect(metrics.status).toBe("FADING");
    expect(metrics.recentResilience).toBe(55);
    expect(metrics.baselineResilience).toBe(75);
    expect(metrics.decayDelta).toBe(-20);
    expect(metrics.recentEventScoreSlope).toBe(-5);
    expect(metrics.decayScore).toBe(50);
  });

  it("does not classify until three recent and five baseline shocks are scored", () => {
    const metrics = calculateResilienceMetrics({
      version: 1,
      market: "xyz:SP500",
      sessionKey: "2026-08-04",
      snapshots: [],
      activeShock: null,
      completedShocks: [
        completedEvent("event-1", 100, 90, 100, null, 100),
        completedEvent("event-2", 100, 90, 100, 100, null),
      ],
    });

    expect(metrics.status).toBe("INSUFFICIENT_DATA");
    expect(metrics.recentResilience).toBeNull();
    expect(metrics.baselineResilience).toBeNull();
    expect(metrics.decayDelta).toBeNull();
  });
});

async function record(
  state: KVNamespace,
  snapshotValue: ResiliencePriceSnapshot,
) {
  return updateResilienceDecayState(state, "xyz:SP500", snapshotValue);
}

function snapshot(
  sessionKey: string,
  minutes: number,
  price: number,
  sessionHigh: number,
  isSessionClose = false,
): ResiliencePriceSnapshot {
  return {
    sessionKey,
    timestamp:
      Date.parse(`${sessionKey}T13:30:00.000Z`) + minutes * 60_000,
    price,
    sessionHigh,
    sessionLow: price,
    isSessionClose,
  };
}

function completedEvent(
  id: string,
  sessionHighAtTrigger: number,
  troughPrice: number,
  oneHourPrice: number | null,
  twoHourPrice: number | null,
  closePrice: number | null,
): ResilienceShockEvent {
  return {
    id,
    sessionKey: "2026-08-04",
    startedAt: Date.parse("2026-08-04T14:00:00.000Z"),
    triggerPrice: 99.4,
    sessionHighAtTrigger,
    troughPrice,
    troughAt: Date.parse("2026-08-04T14:30:00.000Z"),
    oneHourPrice,
    twoHourPrice,
    closePrice,
    recoveredAt: Date.parse("2026-08-04T15:00:00.000Z"),
    completedAt: Date.parse("2026-08-04T16:00:00.000Z"),
    completionReason: "recovered",
  };
}

async function readState(state: KVNamespace): Promise<ResilienceDecayState> {
  const rawState = await state.get("resilience-decay:xyz:SP500");
  if (rawState === null) {
    throw new Error("resilience state was not persisted");
  }
  return JSON.parse(rawState) as ResilienceDecayState;
}

function countingMemoryKv(): KVNamespace & {
  getCount: number;
  putCount: number;
} {
  const values = new Map<string, string>();
  const counters = {
    getCount: 0,
    putCount: 0,
  };
  const state = {
    get: async (key: string) => {
      counters.getCount += 1;
      return values.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      counters.putCount += 1;
      values.set(key, value);
    },
    delete: async () => undefined,
  } as unknown as KVNamespace & {
    getCount: number;
    putCount: number;
  };
  Object.defineProperties(state, {
    getCount: { get: () => counters.getCount },
    putCount: { get: () => counters.putCount },
  });
  return state;
}
