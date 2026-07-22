export interface Env {
  DISCORD_WEBHOOK_URL: string;
  MANUAL_SCAN_TOKEN?: string;
  LANGUAGE?: string;
  HYPERLIQUID_COIN?: string;
  REGULAR_SCAN_MINUTES?: string;
  FINAL_HOUR_SCAN_MINUTES?: string;
  BRIEF_INTERVAL_MINUTES?: string;
  MINIMUM_WATCH_PRICE_R?: string;
  MINIMUM_WATCH_CONFIDENCE_SCORE?: string;
  MINIMUM_PRICE_R?: string;
  MINIMUM_CONFIDENCE_SCORE?: string;
  WORKER_VERSION?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  SCANNER_STATE?: KVNamespace;
}

export type Language = "en" | "zh";

export interface ScannerConfig {
  discordWebhookUrl: string;
  language: Language;
  hyperliquidCoin: string;
  regularScanMinutes: number;
  finalHourScanMinutes: number;
  briefIntervalMinutes: number;
  minimumWatchPriceR: number;
  minimumWatchConfidenceScore: number;
  minimumPriceR: number;
  minimumConfidenceScore: number;
  workerVersionKey: string;
  workerVersionLabel: string;
  workerVersionUploadedAt: Date | null;
  scannerState?: KVNamespace;
}

export interface Candle {
  startTime: number;
  endTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

export type Direction = "bullish" | "bearish";
export type SignalLevel = "watch" | "alert";
export type SignalPolicyRole =
  | "bullish_reversal_zone"
  | "bearish_crash_monitor";

export interface SignalPolicy {
  name: string;
  role: SignalPolicyRole;
  alertEligible: boolean;
  watchEligible: boolean;
  reasons: string[];
}

export interface ReversalLocation {
  level: SignalLevel;
  direction: Direction;
  market: string;
  price: number;
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  target: number;
  sessionHigh: number;
  sessionLow: number;
  vwap: number;
  priceRiskReward: number;
  confidenceScore: number;
  policy: SignalPolicy;
  reasons: string[];
  timestamp: number;
}

export interface ScanResult {
  watch: ReversalLocation | null;
  signal: ReversalLocation | null;
  market: string;
  candleCount: number;
  sessionHigh: number | null;
  sessionLow: number | null;
  latestPrice: number | null;
  status: string;
}
