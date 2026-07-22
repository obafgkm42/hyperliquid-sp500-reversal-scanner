import type { Candle, ScannerConfig } from "./types";

const EASTERN_TIME_ZONE = "America/New_York";
const FINAL_HOUR_START_MINUTE = 15 * 60;
const FINAL_HOUR_END_MINUTE = 16 * 60;
const EASTERN_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const EASTERN_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface EasternTimeParts {
  dateKey: string;
  weekday: string;
  minuteOfDay: number;
}

export interface ScheduleDecision {
  shouldRun: boolean;
  intervalMinutes: number;
  reason: string;
}

/**
 * Decide whether a five-minute Cron invocation should perform a scan.
 *
 * Hyperliquid's SP500 market is available beyond cash SPX hours, so scans are
 * no longer blocked by weekends or RTH. The New York final-hour check only
 * keeps the user's preferred faster cadence near the cash-market close.
 */
export function getScheduleDecision(
  timestamp: Date,
  config: Pick<
    ScannerConfig,
    "regularScanMinutes" | "finalHourScanMinutes"
  >,
): ScheduleDecision {
  const eastern = getEasternTimeParts(timestamp);
  const intervalMinutes =
    eastern.minuteOfDay >= FINAL_HOUR_START_MINUTE &&
    eastern.minuteOfDay < FINAL_HOUR_END_MINUTE
      ? config.finalHourScanMinutes
      : config.regularScanMinutes;
  return {
    shouldRun: eastern.minuteOfDay % intervalMinutes === 0,
    intervalMinutes,
    reason: `24/7 Hyperliquid ${intervalMinutes}-minute cadence`,
  };
}

/**
 * Keep weekend status briefs quieter while preserving the configured weekday
 * cadence.
 */
export function getBriefIntervalMinutes(
  timestamp: Date,
  weekdayIntervalMinutes: number,
): number {
  return isNewYorkWeekend(timestamp)
    ? Math.max(weekdayIntervalMinutes, 60)
    : weekdayIntervalMinutes;
}

/**
 * Keep candles from the current New York date for a stable intraday baseline.
 * When no current-date candles are available, fall back to the fetched lookback
 * so overnight and weekend scans can still produce a Discord brief.
 */
export function filterCurrentSession(
  candles: readonly Candle[],
  timestamp: Date,
): Candle[] {
  const currentDateKey = getEasternDateKey(timestamp);
  const currentDateCandles = candles.filter(
    (candle) => getEasternDateKey(new Date(candle.startTime)) === currentDateKey,
  );
  return currentDateCandles.length > 0 ? currentDateCandles : [...candles];
}

function getEasternTimeParts(timestamp: Date): EasternTimeParts {
  const parts = dateTimePartValues(EASTERN_TIME_FORMATTER, timestamp);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minuteOfDay: hour * 60 + minute,
  };
}

function getEasternDateKey(timestamp: Date): string {
  const dateParts = dateTimePartValues(EASTERN_DATE_FORMATTER, timestamp);
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function dateTimePartValues(
  formatter: Intl.DateTimeFormat,
  timestamp: Date,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(timestamp)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function isNewYorkWeekend(timestamp: Date): boolean {
  const { weekday } = getEasternTimeParts(timestamp);
  return weekday === "Sat" || weekday === "Sun";
}
