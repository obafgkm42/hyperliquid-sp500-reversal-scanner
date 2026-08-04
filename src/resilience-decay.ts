import type {
  ResilienceDecayState,
  ResiliencePriceSnapshot,
  ResilienceShockEvent,
} from "./types";

const RESILIENCE_STATE_PREFIX = "resilience-decay";
const RESILIENCE_STATE_VERSION = 1 as const;
const SHOCK_DROP_THRESHOLD = 0.006;
const CHECKPOINT_ONE_HOUR_MS = 60 * 60 * 1_000;
const CHECKPOINT_TWO_HOURS_MS = 2 * 60 * 60 * 1_000;
const MAX_COMPLETED_SHOCKS = 12;

export interface ResilienceDecayUpdate {
  state: ResilienceDecayState | null;
  changed: boolean;
  approximateCpuMs: number;
  shockStarted: boolean;
  shockCompleted: boolean;
}

/**
 * Record one 30-minute SPX snapshot in the bounded resilience event log.
 *
 * This first-stage module stores raw observations only. Recovery ratios and
 * resilience classifications are intentionally left for later increments.
 */
export async function updateResilienceDecayState(
  state: KVNamespace | undefined,
  market: string,
  snapshot: ResiliencePriceSnapshot,
): Promise<ResilienceDecayUpdate> {
  if (state === undefined) {
    return {
      state: null,
      changed: false,
      approximateCpuMs: 0,
      shockStarted: false,
      shockCompleted: false,
    };
  }

  const rawState = await state.get(resilienceStateKey(market));
  const previousState = parseState(rawState, market);
  const processingStartedAt = performance.now();

  if (previousState !== null && hasSnapshot(previousState, snapshot)) {
    return {
      state: previousState,
      changed: false,
      approximateCpuMs: elapsedMilliseconds(processingStartedAt),
      shockStarted: false,
      shockCompleted: false,
    };
  }

  const update = applySnapshot(previousState, market, snapshot);
  const serializedState = JSON.stringify(update.state);
  const previousSerializedState =
    previousState === null ? null : JSON.stringify(previousState);
  const changed = serializedState !== previousSerializedState;
  if (changed) {
    await state.put(resilienceStateKey(market), serializedState);
  }

  return {
    state: update.state,
    changed,
    approximateCpuMs: elapsedMilliseconds(processingStartedAt),
    shockStarted: update.shockStarted,
    shockCompleted: update.shockCompleted,
  };
}

function applySnapshot(
  previousState: ResilienceDecayState | null,
  market: string,
  snapshot: ResiliencePriceSnapshot,
): {
  state: ResilienceDecayState;
  shockStarted: boolean;
  shockCompleted: boolean;
} {
  if (
    previousState === null ||
    previousState.sessionKey !== snapshot.sessionKey
  ) {
    const previousSession = previousState ?? emptyState(market, snapshot);
    const finalized = finalizePreviousSession(previousSession);
    const nextState: ResilienceDecayState = {
      version: RESILIENCE_STATE_VERSION,
      market,
      sessionKey: snapshot.sessionKey,
      snapshots: [],
      activeShock: null,
      completedShocks: finalized.completedShocks,
    };
    return appendSnapshot(nextState, snapshot);
  }

  return appendSnapshot(previousState, snapshot);
}

function appendSnapshot(
  state: ResilienceDecayState,
  snapshot: ResiliencePriceSnapshot,
): {
  state: ResilienceDecayState;
  shockStarted: boolean;
  shockCompleted: boolean;
} {
  const snapshots = [...state.snapshots, snapshot];
  const currentSessionEvents = state.completedShocks.filter(
    (event) => event.sessionKey === snapshot.sessionKey,
  );
  const olderCompletedShocks = state.completedShocks.filter(
    (event) => event.sessionKey !== snapshot.sessionKey,
  );
  const observedCompletedShocks = currentSessionEvents.map((event) =>
    observeEvent(event, snapshot),
  );
  let activeShock =
    state.activeShock === null
      ? null
      : observeEvent(state.activeShock, snapshot);
  let shockStarted = false;
  let shockCompleted = false;

  if (activeShock !== null) {
    const shouldCompleteAtClose = snapshot.isSessionClose;
    const hasRecovered =
      snapshot.price >=
      activeShock.sessionHighAtTrigger * (1 - SHOCK_DROP_THRESHOLD);
    if (shouldCompleteAtClose || hasRecovered) {
      const completedEvent = completeEvent(
        activeShock,
        snapshot,
        shouldCompleteAtClose ? "session_close" : "recovered",
      );
      observedCompletedShocks.push(completedEvent);
      activeShock = null;
      shockCompleted = true;
    }
  }

  if (
    activeShock === null &&
    !shockCompleted &&
    isShockTrigger(snapshot)
  ) {
    const startedEvent = startEvent(snapshot);
    if (snapshot.isSessionClose) {
      observedCompletedShocks.push(
        completeEvent(startedEvent, snapshot, "session_close"),
      );
      shockCompleted = true;
    } else {
      activeShock = startedEvent;
    }
    shockStarted = true;
  }

  const closeObservedEvents = snapshot.isSessionClose
    ? observedCompletedShocks.map((event) =>
        event.closePrice === null
          ? { ...event, closePrice: snapshot.price }
          : event,
      )
    : observedCompletedShocks;
  const completedShocks = trimCompletedShocks([
    ...olderCompletedShocks,
    ...closeObservedEvents,
  ]);

  return {
    state: {
      ...state,
      snapshots,
      activeShock,
      completedShocks,
    },
    shockStarted,
    shockCompleted,
  };
}

function finalizePreviousSession(state: ResilienceDecayState): {
  completedShocks: ResilienceShockEvent[];
} {
  const lastSnapshot = state.snapshots.at(-1);
  if (lastSnapshot === undefined) {
    return { completedShocks: trimCompletedShocks(state.completedShocks) };
  }

  const completedEvents = state.completedShocks
    .filter((event) => event.sessionKey === state.sessionKey)
    .map((event) =>
      finalizeEventAtClose(observeEvent(event, lastSnapshot), lastSnapshot),
    );
  const olderCompletedShocks = state.completedShocks.filter(
    (event) => event.sessionKey !== state.sessionKey,
  );
  const allEvents = [...olderCompletedShocks, ...completedEvents];
  if (state.activeShock !== null) {
    allEvents.push(
      finalizeEventAtClose(
        observeEvent(state.activeShock, lastSnapshot),
        lastSnapshot,
      ),
    );
  }
  return { completedShocks: trimCompletedShocks(allEvents) };
}

function observeEvent(
  event: ResilienceShockEvent,
  snapshot: ResiliencePriceSnapshot,
): ResilienceShockEvent {
  return {
    ...event,
    troughPrice:
      snapshot.price < event.troughPrice ? snapshot.price : event.troughPrice,
    troughAt:
      snapshot.price < event.troughPrice ? snapshot.timestamp : event.troughAt,
    oneHourPrice:
      event.oneHourPrice === null &&
      snapshot.timestamp >= event.startedAt + CHECKPOINT_ONE_HOUR_MS
        ? snapshot.price
        : event.oneHourPrice,
    twoHourPrice:
      event.twoHourPrice === null &&
      snapshot.timestamp >= event.startedAt + CHECKPOINT_TWO_HOURS_MS
        ? snapshot.price
        : event.twoHourPrice,
  };
}

function startEvent(snapshot: ResiliencePriceSnapshot): ResilienceShockEvent {
  return {
    id: `${snapshot.sessionKey}:${snapshot.timestamp}`,
    sessionKey: snapshot.sessionKey,
    startedAt: snapshot.timestamp,
    triggerPrice: snapshot.price,
    sessionHighAtTrigger: snapshot.sessionHigh,
    troughPrice: snapshot.price,
    troughAt: snapshot.timestamp,
    oneHourPrice: null,
    twoHourPrice: null,
    closePrice: null,
    recoveredAt: null,
    completedAt: null,
    completionReason: null,
  };
}

function completeEvent(
  event: ResilienceShockEvent,
  snapshot: ResiliencePriceSnapshot,
  reason: "recovered" | "session_close",
): ResilienceShockEvent {
  return {
    ...event,
    closePrice: snapshot.isSessionClose ? snapshot.price : event.closePrice,
    recoveredAt:
      reason === "recovered" ? snapshot.timestamp : event.recoveredAt,
    completedAt: snapshot.timestamp,
    completionReason: reason,
  };
}

function finalizeEventAtClose(
  event: ResilienceShockEvent,
  closeSnapshot: ResiliencePriceSnapshot,
): ResilienceShockEvent {
  return {
    ...event,
    closePrice: closeSnapshot.price,
    completedAt: event.completedAt ?? closeSnapshot.timestamp,
    completionReason: event.completionReason ?? "session_close",
  };
}

function isShockTrigger(snapshot: ResiliencePriceSnapshot): boolean {
  return (
    snapshot.price <= snapshot.sessionHigh * (1 - SHOCK_DROP_THRESHOLD)
  );
}

function emptyState(
  market: string,
  snapshot: ResiliencePriceSnapshot,
): ResilienceDecayState {
  return {
    version: RESILIENCE_STATE_VERSION,
    market,
    sessionKey: snapshot.sessionKey,
    snapshots: [],
    activeShock: null,
    completedShocks: [],
  };
}

function trimCompletedShocks(
  completedShocks: readonly ResilienceShockEvent[],
): ResilienceShockEvent[] {
  return completedShocks.slice(-MAX_COMPLETED_SHOCKS);
}

function hasSnapshot(
  state: ResilienceDecayState,
  snapshot: ResiliencePriceSnapshot,
): boolean {
  return state.sessionKey === snapshot.sessionKey &&
    state.snapshots.some((item) => item.timestamp === snapshot.timestamp);
}

function parseState(
  rawState: string | null,
  market: string,
): ResilienceDecayState | null {
  if (rawState === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(rawState);
    if (!isResilienceDecayState(parsed, market)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isResilienceDecayState(
  value: unknown,
  market: string,
): value is ResilienceDecayState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ResilienceDecayState>;
  return (
    candidate.version === RESILIENCE_STATE_VERSION &&
    candidate.market === market &&
    typeof candidate.sessionKey === "string" &&
    Array.isArray(candidate.snapshots) &&
    Array.isArray(candidate.completedShocks) &&
    (candidate.activeShock === null ||
      typeof candidate.activeShock === "object")
  );
}

function resilienceStateKey(market: string): string {
  return `${RESILIENCE_STATE_PREFIX}:${market}`;
}

function elapsedMilliseconds(startedAt: number): number {
  return Number(Math.max(0, performance.now() - startedAt).toFixed(3));
}
